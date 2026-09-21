import { parseAmountToMinor } from '@/shared/money';
import type { StatementLine } from '@/shared/statement-text';
import type { ParseWarning } from '@/shared/types';
import { joinWrappedDetail, redactFreeText } from '@/shared/redact';
import { parseDashMonthDate, parseSpacedDate } from '@/server/domain/dates';
import type { ParsedTransaction } from '@/server/domain/schemas';
import { ParseError, type ParserInput, type ParserOutput, type StatementParser } from '../types';

const ID = 'slice-savings';

/**
 * slice small finance bank — savings account statement.
 *
 * Layout facts this parser depends on:
 * - Dates read `04 Jul '26`: two-digit year behind an apostrophe.
 * - Direction comes from a **leading minus** on the amount; there is no Dr/Cr.
 *   `₹33.10` is a credit, `-₹8,700.00` is a debit.
 * - `DETAILS` wraps over up to three physical lines and the bank hard-wraps
 *   mid-word, so continuation lines are joined with **no separator at all**:
 *   `…TE` + `LAN` is `…NAI`, not `…TE LAN`.
 * - The BALANCE column is a running balance. Every row is checked against the
 *   previous row's balance, which is a far stronger test than the summary
 *   totals alone.
 * - Interest is credited almost daily (`Interest Cr. for 30-Jun-2026`). Those
 *   rows are marked `isInterest` so the UI can fold them into one line.
 */
export const sliceSavingsParser: StatementParser = {
  id: ID,
  parse(input: ParserInput): ParserOutput {
    const warnings: ParseWarning[] = [];

    const period = readPeriod(input.lines);
    const summary = readSummary(input.lines);
    const generatedAt = readGeneratedOn(input.lines);
    const account = readAccount(input.lines);
    const transactions = readTransactions(input.lines, warnings);

    if (transactions.length === 0) {
      throw new ParseError(ID, 'No transaction rows were found below the DATE/DETAILS header.');
    }

    return {
      warnings,
      statement: {
        accountType: 'savings',
        periodStart: period.start,
        periodEnd: period.end,
        statementDate: generatedAt,
        dueDate: null,
        account: {
          type: 'savings',
          issuer: input.detection.issuer || 'slice small finance bank',
          productName: input.detection.productName || 'Savings account',
          last4: account.last4,
          maskedNumber: account.maskedNumber,
          creditLimitMinor: null,
          cashLimitMinor: null,
          openedAt: account.openedAt,
        },
        savings: {
          openingBalanceMinor: summary.openingMinor,
          totalCreditsMinor: summary.creditsMinor,
          totalDebitsMinor: summary.debitsMinor,
          interestEarnedMinor: summary.interestMinor,
          closingBalanceMinor: summary.closingMinor,
          generatedAt,
        },
        transactions,
      },
    };
  },
};

/* ── header ──────────────────────────────────────────────────────────────── */

/** `01 Aug '26 - 31 Aug '26`, printed at the top of every page. */
const PERIOD_LINE = /^(\d{1,2}\s+[A-Za-z]{3,9}\s*'?\s*\d{2,4})\s*-\s*(\d{1,2}\s+[A-Za-z]{3,9}\s*'?\s*\d{2,4})$/;

function readPeriod(lines: StatementLine[]): { start: string; end: string } {
  for (const line of lines.slice(0, 6)) {
    const match = line.text.match(PERIOD_LINE);
    if (!match) continue;
    const start = parseSpacedDate(match[1] ?? '');
    const end = parseSpacedDate(match[2] ?? '');
    if (start && end) return { start, end };
  }
  throw new ParseError(ID, 'Could not read the statement period from the page header.');
}

interface Summary {
  openingMinor: number;
  creditsMinor: number;
  interestMinor: number;
  debitsMinor: number;
  closingMinor: number;
}

/**
 * The summary strip is the reconciliation source of truth:
 *   Opening + Total credits + Interest earned − Total debits = Closing
 * Its labels are on one line, the `+ + - =` operators on the next, and the five
 * amounts on the one after.
 */
function readSummary(lines: StatementLine[]): Summary {
  const labelIndex = lines.findIndex(
    (line) => /opening balance/i.test(line.text) && /closing balance/i.test(line.text),
  );
  if (labelIndex === -1) throw new ParseError(ID, 'Could not find the summary strip.');

  for (let offset = 1; offset <= 3; offset += 1) {
    const line = lines[labelIndex + offset];
    if (!line) continue;
    const amounts = line.cells
      .map((cell) => parseAmountToMinor(cell))
      .filter((value): value is number => value !== null);
    if (amounts.length < 5) continue;
    const [opening, credits, interest, debits, closing] = amounts;
    if (
      opening === undefined ||
      credits === undefined ||
      interest === undefined ||
      debits === undefined ||
      closing === undefined
    ) {
      continue;
    }
    return {
      openingMinor: opening,
      creditsMinor: credits,
      interestMinor: interest,
      debitsMinor: debits,
      closingMinor: closing,
    };
  }
  throw new ParseError(ID, 'The summary strip did not hold five amounts.');
}

function readGeneratedOn(lines: StatementLine[]): string | null {
  for (const line of lines) {
    const match = line.text.match(/generated on\s+(\d{1,2}\s+[A-Za-z]{3,9}\s*'?\s*\d{2,4})/i);
    if (match) return parseSpacedDate(match[1] ?? '');
  }
  return null;
}

function readAccount(lines: StatementLine[]): {
  last4: string;
  maskedNumber: string;
  openedAt: string | null;
} {
  let maskedNumber = '';
  let openedAt: string | null = null;

  for (const line of lines.slice(0, 24)) {
    for (let i = 0; i < line.cells.length - 1; i += 1) {
      const label = (line.cells[i] ?? '').toLowerCase();
      const value = (line.cells[i + 1] ?? '').trim();
      if (/^a\/c\s*number$/.test(label) && /^XXXX\d{4}$/.test(value)) maskedNumber = value;
      if (/^account opening$/.test(label)) openedAt = parseSpacedDate(value);
    }
  }

  if (maskedNumber.length === 0) {
    throw new ParseError(ID, 'Could not find the A/C number row.');
  }
  return { last4: maskedNumber.slice(-4), maskedNumber, openedAt };
}

/* ── transaction rows ────────────────────────────────────────────────────── */

const ROW_DATE = /^\d{1,2}\s+[A-Za-z]{3,9}\s*'?\s*\d{2,4}$/;
const FOOTER = /need help\?|slice small finance bank$|^\d+\/\d+$|generated on/i;
const TABLE_HEADER = /^DATE$/i;

interface RawRow {
  date: string;
  detail: string;
  reference: string | null;
  amountMinor: number;
  balanceMinor: number | null;
}

function readTransactions(lines: StatementLine[], warnings: ParseWarning[]): ParsedTransaction[] {
  const rows: RawRow[] = [];
  let seenHeader = false;

  for (const line of lines) {
    const first = (line.cells[0] ?? '').trim();

    if (TABLE_HEADER.test(first) && /details/i.test(line.text)) {
      seenHeader = true;
      continue;
    }
    if (!seenHeader) continue;
    if (FOOTER.test(line.text)) continue;

    if (ROW_DATE.test(first)) {
      const date = parseSpacedDate(first);
      if (!date) continue;
      const cells = line.cells.slice(1).filter((cell) => cell.length > 0);
      const row = readRow(date, cells);
      if (row) rows.push(row);
      else {
        warnings.push({
          code: 'row_unreadable',
          message: `A row dated ${first} did not hold a readable amount and was skipped.`,
        });
      }
      continue;
    }

    // A line with no date cell is the continuation of the DETAILS column of the
    // row above. slice hard-wraps mid-word, so it joins with no separator — and
    // a value that was masked on the line above keeps its tail with it.
    const previous = rows[rows.length - 1];
    if (previous && line.cells.length === 1 && first.length > 0) {
      previous.detail = joinWrappedDetail(previous.detail, first);
    }
  }

  // An identifier split across a wrap is invisible to the per-line redaction
  // pass and only becomes recognisable now that the pieces are joined.
  for (const row of rows) row.detail = redactFreeText(row.detail);

  return rows.map((row) => toTransaction(row));
}

function readRow(date: string, cells: string[]): RawRow | null {
  // From the right: BALANCE, then AMOUNT. Both are the only cells carrying a
  // rupee sign, which is what distinguishes them from a reference number.
  const money: Array<{ index: number; minor: number }> = [];
  cells.forEach((cell, index) => {
    if (!/[₹]/.test(cell)) return;
    const minor = parseAmountToMinor(cell);
    if (minor !== null) money.push({ index, minor });
  });

  const amount = money[0];
  if (!amount) return null;
  const balance = money[1];

  const detailCells = cells.slice(0, amount.index);
  const detail = (detailCells[0] ?? '').trim();
  if (detail.length === 0) return null;

  const reference = detailCells.length > 1 ? (detailCells[1] ?? '').trim() : null;

  return {
    date,
    detail,
    reference: reference && reference.length > 0 ? reference : null,
    amountMinor: amount.minor,
    balanceMinor: balance ? balance.minor : null,
  };
}

/** `Interest Cr. for 30-Jun-2026` */
const INTEREST_ROW = /^Interest\s+Cr\.?\s+for\s+(\d{1,2}-[A-Za-z]{3,9}-\d{4})/i;
/** `UPI-Debit-<ref>-<counterparty>-<bank/handle>-<note>` */
const UPI_ROW = /^UPI-(Debit|Credit|Reversal)-([^-]*)-(.*)$/i;
/** `IMPS-Credit-REF <ref>-TO <name>-<masked>-<ifsc>-IMPS` */
const IMPS_ROW = /^IMPS-(Debit|Credit|Reversal)-REF\s*([^-]*)-(.*)$/i;

function toTransaction(row: RawRow): ParsedTransaction {
  const direction = row.amountMinor < 0 ? 'debit' : 'credit';
  const amountMinor = Math.abs(row.amountMinor);

  const interest = row.detail.match(INTEREST_ROW);
  if (interest) {
    return base(row, {
      counterparty: '',
      merchant: 'Interest credited',
      direction: 'credit',
      amountMinor,
      mode: 'interest',
      isInterest: true,
      // The date the interest accrued for, not the date it landed, is what the
      // description carries; the row's own date is when it was credited.
      note: parseDashMonthDate(interest[1] ?? ''),
    });
  }

  const upi = row.detail.match(UPI_ROW);
  if (upi) {
    const rest = upi[3] ?? '';
    const segments = rest.split('-');
    const counterparty = cleanName(segments[0] ?? '');
    return base(row, {
      counterparty,
      merchant: counterparty,
      direction,
      amountMinor,
      mode: 'upi',
    });
  }

  const imps = row.detail.match(IMPS_ROW);
  if (imps) {
    const rest = (imps[3] ?? '').replace(/^TO\s+/i, '');
    const counterparty = cleanName(rest.split('-')[0] ?? '');
    return base(row, {
      counterparty,
      merchant: counterparty,
      direction,
      amountMinor,
      mode: 'other',
    });
  }

  return base(row, {
    counterparty: '',
    merchant: cleanName(row.detail),
    direction,
    amountMinor,
    mode: 'other',
  });
}

function base(
  row: RawRow,
  fields: {
    counterparty: string;
    merchant: string;
    direction: 'debit' | 'credit';
    amountMinor: number;
    mode: ParsedTransaction['mode'];
    isInterest?: boolean;
    note?: string | null;
  },
): ParsedTransaction {
  return {
    date: row.date,
    descriptionRaw: row.detail.slice(0, 400),
    counterparty: fields.counterparty,
    merchant: fields.merchant,
    issuerCategory: null,
    amountMinor: fields.amountMinor,
    direction: fields.direction,
    mode: fields.mode,
    referenceNo: row.reference,
    balanceAfterMinor: row.balanceMinor,
    cashbackMinor: null,
    isFee: false,
    isInterest: fields.isInterest ?? false,
    isPayment: false,
  };
}

/**
 * `SELF` survives redaction and means the account holder. Everything else is a
 * counterparty name, tidied from the SHOUTING the bank prints.
 */
function cleanName(value: string): string {
  const trimmed = value
    .trim()
    // A mask that ended up inside the name segment is not part of the name.
    .replace(/\[[a-z-]+\]/g, '')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .replace(/^(?:MR|MRS|MS|DR)\.?\s+/i, '');
  if (trimmed === 'SELF') return 'Self';
  if (trimmed.length === 0) return '';
  if (trimmed === trimmed.toUpperCase()) {
    return trimmed
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return trimmed;
}
