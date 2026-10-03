import {
  parseAmountToMinor,
  redactFreeText,
  type StatementLine,
  type ParseWarning,
} from '@cred-stats/shared';
import { parseSpacedDate } from '../../domain/statement-dates.js';
import { ParseError, type ParserInput, type ParserOutput, type StatementParser } from '../types.js';
import type { ParsedTransaction } from '../../domain/schemas.js';

const ID = 'slice-credit-card';

/**
 * slice — UPI credit card statement.
 *
 * The same issuer as `slice-savings` and not remotely the same document, which
 * is the first thing to keep straight. The savings statement is a ledger: a
 * dated table with a running balance. This is a receipt — a summary block, a
 * list of spends, and no balance column anywhere. They share no marker, so the
 * fingerprints stay apart on their own, but the two parsers must never be
 * swapped by someone reading only the issuer.
 *
 * Layout facts this parser depends on:
 *
 * - **Nothing carries a year.** The cycle prints as `03 SEP - 02 OCT` and the
 *   due date as `Due on 18 Oct`. Only the transactions are dated in full
 *   (`2 Oct '26`), so the year is taken from them and walked back across the
 *   boundary: a cycle whose start month is after its end month began in the
 *   previous year.
 *
 * - **A transaction is three printed lines**: the merchant and amount on one,
 *   the avatar's single letter on the next, then the date and mode. The letter
 *   is the merchant's own initial and carries nothing — it is skipped.
 *
 * - **The summary is label/amount pairs, and the set of labels varies.** This
 *   month shows spends, refunds, interest and surcharge; the glossary also
 *   names carry forward, late fee, flat fee, foreclosure charge, ongoing EMIs
 *   and bank transfers, none of which appear when they are zero. So labels are
 *   mapped by name rather than by position, and an unrecognised one raises a
 *   warning instead of being silently dropped — with one statement to go on,
 *   the labels we have not seen are the ones worth hearing about.
 *
 * - **`monies` are points, not money.** slice credits 450 "monies" for ₹450 of
 *   spend; they are not rupees and are deliberately not reported as cashback,
 *   which the card block measures in paise.
 */
export const sliceCreditCardParser: StatementParser = {
  id: ID,
  parse(input: ParserInput): ParserOutput {
    const warnings: ParseWarning[] = [];

    const page1 = input.lines.filter((line) => line.pageNumber === 1);
    if (page1.length === 0) throw new ParseError(ID, 'The statement has no first page.');

    const cycle = readCycle(page1);
    const last4 = readLast4(page1);
    const summary = readSummary(page1, warnings);
    const transactions = readTransactions(input.lines, cycle, warnings);

    if (transactions.length === 0) {
      throw new ParseError(ID, 'No spends were found below the Spends heading.');
    }

    const year = yearFrom(transactions, cycle);
    const periodEnd = isoFrom(cycle.endDay, cycle.endMonth, year);
    const periodStart = isoFrom(
      cycle.startDay,
      cycle.startMonth,
      // A cycle that opens in a later month than it closes crossed New Year.
      cycle.startMonth > cycle.endMonth ? year - 1 : year,
    );

    const spentMinor = transactions.reduce((total, txn) => total + txn.amountMinor, 0);
    if (summary.purchasesMinor !== spentMinor) {
      warnings.push({
        code: 'spends_mismatch',
        message:
          'The listed spends do not add up to the Spends figure in the summary. ' +
          'Both are kept; the summary is what the figures reconcile against.',
      });
    }

    return {
      warnings,
      statement: {
        accountType: 'credit_card',
        periodStart,
        periodEnd,
        statementDate: periodEnd,
        dueDate:
          cycle.dueDay === null || cycle.dueMonth === null
            ? null
            : isoFrom(
                cycle.dueDay,
                cycle.dueMonth,
                // Payment falls after the cycle closes, so a due month earlier
                // than the closing month belongs to the following year.
                cycle.dueMonth < cycle.endMonth ? year + 1 : year,
              ),
        account: {
          type: 'credit_card',
          issuer: input.detection.issuer || 'slice',
          productName: input.detection.productName || 'UPI credit card',
          last4,
          maskedNumber: `XXXX${last4}`,
          creditLimitMinor: null,
          cashLimitMinor: null,
          openedAt: null,
        },
        card: {
          previousBalanceMinor: summary.previousBalanceMinor,
          paymentsMinor: 0,
          creditsMinor: summary.creditsMinor,
          purchasesMinor: summary.purchasesMinor,
          cashAdvanceMinor: summary.cashAdvanceMinor,
          otherDebitsMinor: summary.otherDebitsMinor,
          totalDueMinor: summary.totalDueMinor,
          minimumDueMinor: summary.minimumDueMinor,
          creditLimitMinor: 0,
          availableCreditMinor: 0,
          cashLimitMinor: 0,
          // `monies` are reward points, not rupees. Reporting them here would
          // put a point count into a field the rest of the app spends.
          cashbackEarnedMinor: 0,
          cashbackCreditedMinor: 0,
        },
        transactions,
      },
    };
  },
};

/* ── the cycle, which is printed without a year ──────────────────────────── */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndex(name: string): number | null {
  const at = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return at === -1 ? null : at + 1;
}

interface Cycle {
  startDay: number;
  startMonth: number;
  endDay: number;
  endMonth: number;
  dueDay: number | null;
  dueMonth: number | null;
}

/** `03 SEP - 02 OCT`, and `Due on 18 Oct` a couple of lines below it. */
const CYCLE = /^(\d{1,2})\s+([A-Za-z]{3,9})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9})$/;
const DUE = /^Due\s+on\s+(\d{1,2})\s+([A-Za-z]{3,9})$/i;

function readCycle(page1: StatementLine[]): Cycle {
  let cycle: Omit<Cycle, 'dueDay' | 'dueMonth'> | null = null;
  let dueDay: number | null = null;
  let dueMonth: number | null = null;

  for (const line of page1) {
    const text = line.text.trim();

    if (cycle === null) {
      const match = CYCLE.exec(text);
      const startMonth = monthIndex(match?.[2] ?? '');
      const endMonth = monthIndex(match?.[4] ?? '');
      if (match && startMonth !== null && endMonth !== null) {
        cycle = {
          startDay: Number(match[1]),
          startMonth,
          endDay: Number(match[3]),
          endMonth,
        };
      }
    }

    const due = DUE.exec(text);
    const month = monthIndex(due?.[2] ?? '');
    if (due && month !== null && dueDay === null) {
      dueDay = Number(due[1]);
      dueMonth = month;
    }
  }

  if (cycle === null) {
    throw new ParseError(ID, 'Could not read the billing cycle from the first page.');
  }
  return { ...cycle, dueDay, dueMonth };
}

/**
 * The year, taken from the transactions because nothing else on the statement
 * carries one.
 *
 * The closing month is the anchor: whichever transaction falls in it was
 * written in the year the cycle closed. Falling back to the latest transaction
 * covers a cycle whose last month happens to be empty.
 */
function yearFrom(transactions: ParsedTransaction[], cycle: Cycle): number {
  const dates = transactions.map((txn) => txn.date).sort();
  const closing = dates.find((date) => Number(date.slice(5, 7)) === cycle.endMonth);
  const anchor = closing ?? dates[dates.length - 1];
  if (anchor === undefined) {
    throw new ParseError(ID, 'No transaction carried a year to date the cycle by.');
  }
  return Number(anchor.slice(0, 4));
}

function isoFrom(day: number, month: number, year: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ParseError(
      ID,
      `The cycle names a date that does not exist: ${day}/${month}/${year}.`,
    );
  }
  return date.toISOString().slice(0, 10);
}

/** `X X X X | X X X X | X X X X | 1 2 2 3` — the digits are printed spaced out. */
function readLast4(page1: StatementLine[]): string {
  for (const line of page1) {
    const cells = line.cells.map((cell) => cell.replace(/\s+/g, ''));
    const last = cells[cells.length - 1] ?? '';
    if (
      cells.length >= 2 &&
      /^\d{4}$/.test(last) &&
      cells.slice(0, -1).every((c) => /^[X*]+$/i.test(c))
    ) {
      return last;
    }
  }
  throw new ParseError(ID, 'Could not find the masked card number.');
}

/* ── the summary block ───────────────────────────────────────────────────── */

interface Summary {
  previousBalanceMinor: number;
  creditsMinor: number;
  purchasesMinor: number;
  cashAdvanceMinor: number;
  otherDebitsMinor: number;
  totalDueMinor: number;
  minimumDueMinor: number;
}

/**
 * Where each summary label lands in the card block. Anything charged that is
 * not a purchase or a cash advance is an other-debit, which is what the
 * reconciliation equation expects.
 */
const SUMMARY_LABELS: ReadonlyArray<{ label: RegExp; field: keyof Summary; adds: boolean }> = [
  { label: /^spends$/i, field: 'purchasesMinor', adds: true },
  { label: /^refunds?\s*&\s*repayments?$/i, field: 'creditsMinor', adds: true },
  { label: /^carry\s*forward$/i, field: 'previousBalanceMinor', adds: true },
  { label: /^bank\s*transfers?$/i, field: 'cashAdvanceMinor', adds: true },
  { label: /^interest$/i, field: 'otherDebitsMinor', adds: true },
  { label: /^surcharge$/i, field: 'otherDebitsMinor', adds: true },
  { label: /^(?:late|flat)\s*fee$/i, field: 'otherDebitsMinor', adds: true },
  { label: /^foreclosure\s*charge$/i, field: 'otherDebitsMinor', adds: true },
  { label: /^ongoing\s*emis?$/i, field: 'otherDebitsMinor', adds: true },
  { label: /^total\s*amount\s*due$/i, field: 'totalDueMinor', adds: false },
  { label: /^min(?:imum)?\s*amount\s*due$/i, field: 'minimumDueMinor', adds: false },
];

/** `Min amount due₹200.00` — the last row is printed with no separator. */
const GLUED_ROW = /^(.*?)(₹\s*[\d,]+(?:\.\d{2})?)$/;

function readSummary(page1: StatementLine[], warnings: ParseWarning[]): Summary {
  const start = page1.findIndex((line) => /^statement summary$/i.test(line.text.trim()));
  if (start === -1) throw new ParseError(ID, 'Could not find the Statement summary block.');

  const summary: Summary = {
    previousBalanceMinor: 0,
    creditsMinor: 0,
    purchasesMinor: 0,
    cashAdvanceMinor: 0,
    otherDebitsMinor: 0,
    totalDueMinor: 0,
    minimumDueMinor: 0,
  };
  let sawTotal = false;

  for (const line of page1.slice(start + 1)) {
    const cells = line.cells.map((cell) => cell.trim()).filter((cell) => cell.length > 0);
    let label = cells[0] ?? '';
    let amount = cells.length > 1 ? (cells[cells.length - 1] ?? '') : '';

    // The minimum-due row arrives as one cell with no tab in it.
    if (amount === '') {
      const glued = GLUED_ROW.exec(label);
      if (!glued) continue;
      label = (glued[1] ?? '').trim();
      amount = glued[2] ?? '';
    }

    const minor = parseAmountToMinor(amount);
    if (minor === null) continue;

    const rule = SUMMARY_LABELS.find((candidate) => candidate.label.test(label));
    if (!rule) {
      warnings.push({
        code: 'unknown_summary_row',
        message:
          `The summary row "${label}" is one this parser has not seen, so it was left out of ` +
          'the figures. The totals may not reconcile until it is mapped.',
      });
      continue;
    }

    if (rule.adds) summary[rule.field] += minor;
    else summary[rule.field] = minor;
    if (rule.field === 'totalDueMinor') sawTotal = true;
  }

  if (!sawTotal) throw new ParseError(ID, 'The summary block carried no Total amount due.');
  return summary;
}

/* ── the spends ──────────────────────────────────────────────────────────── */

/** `2 Oct '26 • UPI` — the only line of a spend that carries a year. */
const SPEND_DATE = /^(\d{1,2}\s+[A-Za-z]{3,9}\s*['’]\s*\d{2})\s*[•·]\s*(.+)$/;

function modeOf(raw: string): ParsedTransaction['mode'] {
  const mode = raw.trim().toLowerCase();
  if (mode.startsWith('upi')) return 'upi';
  if (mode.startsWith('card') || mode.includes('pos')) return 'card';
  return 'other';
}

function readTransactions(
  lines: StatementLine[],
  cycle: Cycle,
  warnings: ParseWarning[],
): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  /** Every row under `Spends` is money leaving; a refunds section would not be. */
  let direction: ParsedTransaction['direction'] = 'debit';
  let inSection = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const heading = line.text.trim();

    if (/^spends$/i.test(heading) && line.cells.length === 1) {
      inSection = true;
      direction = 'debit';
      continue;
    }
    if (/^(?:refunds?|repayments?)$/i.test(heading) && line.cells.length === 1) {
      inSection = true;
      direction = 'credit';
      continue;
    }
    // The spends list ends where the next part of the statement begins.
    if (/^(?:gst details|monies|glossary)$/i.test(heading)) inSection = false;
    if (!inSection) continue;

    const cells = line.cells.map((cell) => cell.trim());
    const amountMinor =
      cells.length >= 2 ? parseAmountToMinor(cells[cells.length - 1] ?? '') : null;
    if (amountMinor === null || amountMinor <= 0) continue;

    const merchant = cells.slice(0, -1).join(' ').replace(/\s+/g, ' ').trim();
    if (merchant.length === 0) continue;

    // The two lines under a spend are its avatar letter and its date. The
    // letter is the merchant's own initial and carries nothing.
    const dated = findSpendDate(lines, i);
    if (dated === null) {
      warnings.push({
        code: 'spend_undated',
        message: `The spend "${merchant}" had no date line under it and was left out.`,
      });
      continue;
    }

    out.push({
      date: dated.date,
      // The bank truncates a long name to fit the row; the ellipsis is its
      // doing, not part of anyone's name.
      descriptionRaw: redactFreeText(merchant.replace(/[…]+$/u, '').trim()).slice(0, 400),
      counterparty: '',
      merchant: merchant.replace(/[…]+$/u, '').trim().slice(0, 200),
      issuerCategory: null,
      amountMinor,
      direction,
      mode: dated.mode,
      referenceNo: null,
      balanceAfterMinor: null,
      cashbackMinor: null,
      isFee: false,
      isInterest: false,
      isPayment: direction === 'credit',
    });
    void cycle;
  }

  return out;
}

/** Looks just past a spend row for the line carrying its date and mode. */
function findSpendDate(
  lines: StatementLine[],
  from: number,
): { date: string; mode: ParsedTransaction['mode'] } | null {
  for (let i = from + 1; i <= from + 3 && i < lines.length; i += 1) {
    const candidate = lines[i];
    if (candidate === undefined) continue;
    const match = SPEND_DATE.exec(candidate.text.trim());
    if (!match) continue;
    const date = parseSpacedDate((match[1] ?? '').replace(/\s*['’]\s*/, " '"));
    if (date === null) continue;
    return { date, mode: modeOf(match[2] ?? '') };
  }
  return null;
}
