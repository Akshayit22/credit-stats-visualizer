import { parseAmountToMinor, type StatementLine, type ParseWarning } from '@cred-stats/shared';
import { parseSlashDate } from '../../domain/statement-dates.js';
import type { ParsedTransaction } from '../../domain/schemas.js';
import { ParseError, type ParserInput, type ParserOutput, type StatementParser } from '../types.js';

const ID = 'axis-supermoney-card';

/**
 * Axis Bank super.money RuPay credit card.
 *
 * Layout facts this parser depends on:
 * - Direction comes from a `Dr` / `Cr` **suffix**, never a minus sign.
 * - Dates are `DD/MM/YYYY`.
 * - The equation row is the reconciliation source of truth:
 *   `Previous Balance − Payments − Credits + Purchase + Cash Advance
 *    + Other Debit&Charges = Total Payment Due`.
 * - `Cashback Earned` and `Cashback Credited` are different numbers and both
 *   matter: earned is this cycle's, credited is last cycle's arriving now.
 * - **Page 2 is the schedule of charges.** It is full of amounts and of
 *   date-ish strings like `25th Sep`, and the finance-charge and MAD worked
 *   examples would parse as transactions if anything let them. Nothing does:
 *   rows are only read between the table header and `End of Statement`, both of
 *   which are on page 1, and every row must start with a `DD/MM/YYYY` cell.
 */
export const axisSupermoneyCardParser: StatementParser = {
  id: ID,
  parse(input: ParserInput): ParserOutput {
    const warnings: ParseWarning[] = [];
    const page1 = input.lines.filter((line) => line.pageNumber === 1);
    if (page1.length === 0) throw new ParseError(ID, 'The statement has no first page.');

    const header = readHeader(page1);
    const equation = readEquation(page1);
    const cashback = readCashback(page1);
    const { transactions, skippedPages } = readTransactions(input, warnings);

    if (transactions.length === 0) {
      throw new ParseError(
        ID,
        'No transaction rows were found between the table header and the end marker.',
      );
    }
    if (skippedPages.length > 0) {
      warnings.push({
        code: 'pages_skipped',
        message: `Skipped ${skippedPages.length} page(s) with no dated rows — on this statement that is the schedule of charges.`,
      });
    }

    const creditLimitMinor = header.creditLimitMinor ?? 0;

    return {
      warnings,
      statement: {
        accountType: 'credit_card',
        periodStart: header.periodStart,
        periodEnd: header.periodEnd,
        statementDate: header.statementDate,
        dueDate: header.dueDate,
        account: {
          type: 'credit_card',
          issuer: input.detection.issuer || 'Axis Bank',
          productName: input.detection.productName || 'Supermoney RuPay Credit Card',
          last4: header.last4,
          maskedNumber: header.maskedNumber,
          creditLimitMinor: header.creditLimitMinor,
          cashLimitMinor: header.cashLimitMinor,
          openedAt: null,
        },
        card: {
          previousBalanceMinor: equation.previousBalanceMinor,
          paymentsMinor: equation.paymentsMinor,
          creditsMinor: equation.creditsMinor,
          purchasesMinor: equation.purchasesMinor,
          cashAdvanceMinor: equation.cashAdvanceMinor,
          otherDebitsMinor: equation.otherDebitsMinor,
          totalDueMinor: equation.totalDueMinor,
          minimumDueMinor: header.minimumDueMinor,
          creditLimitMinor,
          availableCreditMinor: header.availableCreditMinor ?? 0,
          cashLimitMinor: header.cashLimitMinor ?? 0,
          cashbackEarnedMinor: cashback.earnedMinor,
          cashbackCreditedMinor: cashback.creditedMinor,
        },
        transactions,
      },
    };
  },
};

/* ── header ──────────────────────────────────────────────────────────────── */

interface CardHeader {
  periodStart: string;
  periodEnd: string;
  statementDate: string | null;
  dueDate: string | null;
  totalDueMinor: number;
  minimumDueMinor: number;
  last4: string;
  maskedNumber: string;
  creditLimitMinor: number | null;
  availableCreditMinor: number | null;
  cashLimitMinor: number | null;
}

const DATE_TOKEN = /\b\d{2}\/\d{2}\/\d{4}\b/g;

function readHeader(lines: StatementLine[]): CardHeader {
  const labelIndex = lines.findIndex((line) => /total payment due/i.test(line.text));
  if (labelIndex === -1) throw new ParseError(ID, 'Could not find the payment summary.');

  // The label row and its values can land on adjacent printed lines depending on
  // how the PDF rounds baselines, so read a small window rather than one line.
  const window = lines
    .slice(labelIndex, labelIndex + 3)
    .map((line) => line.text)
    .join(' ');

  const dates = window.match(DATE_TOKEN) ?? [];
  const periodStart = parseSlashDate(dates[0] ?? '');
  const periodEnd = parseSlashDate(dates[1] ?? '');
  if (!periodStart || !periodEnd) {
    throw new ParseError(ID, 'Could not read the statement period.');
  }

  const amounts = amountsOnLine(window);
  const totalDueMinor = amounts[0] ?? 0;
  const minimumDueMinor = amounts[1] ?? 0;

  const cardLine = lines.find((line) => /^XXXX\d{4}$/.test(line.cells[0] ?? ''));
  const maskedNumber = cardLine?.cells[0] ?? '';
  const last4 = maskedNumber.slice(-4);
  if (!/^\d{4}$/.test(last4)) {
    throw new ParseError(ID, 'Could not find the card number row.');
  }

  const limits = (cardLine?.cells ?? []).slice(1).map((cell) => parseAmountToMinor(cell));

  return {
    periodStart,
    periodEnd,
    statementDate: parseSlashDate(dates[3] ?? '') ?? parseSlashDate(dates[2] ?? ''),
    dueDate: parseSlashDate(dates[2] ?? ''),
    totalDueMinor,
    minimumDueMinor,
    last4,
    maskedNumber,
    creditLimitMinor: limits[0] ?? null,
    availableCreditMinor: limits[1] ?? null,
    cashLimitMinor: limits[2] ?? null,
  };
}

/* ── the equation row ────────────────────────────────────────────────────── */

interface Equation {
  previousBalanceMinor: number;
  paymentsMinor: number;
  creditsMinor: number;
  purchasesMinor: number;
  cashAdvanceMinor: number;
  otherDebitsMinor: number;
  totalDueMinor: number;
}

function readEquation(lines: StatementLine[]): Equation {
  const labelIndex = lines.findIndex((line) =>
    /previous balance\s*-\s*payments/i.test(line.text.replace(/\s+/g, ' ')),
  );
  if (labelIndex === -1) throw new ParseError(ID, 'Could not find the account summary equation.');

  // The values sit on one of the next two lines, mixed with marketing copy in
  // the right-hand column. Take the first line that yields seven amounts.
  for (let offset = 1; offset <= 3; offset += 1) {
    const line = lines[labelIndex + offset];
    if (!line) continue;
    const amounts = line.cells
      .map((cell) => parseAmountToMinor(cell))
      .filter((value): value is number => value !== null);
    if (amounts.length < 7) continue;
    const [previous, payments, credits, purchases, cashAdvance, otherDebits, totalDue] = amounts;
    if (
      previous === undefined ||
      payments === undefined ||
      credits === undefined ||
      purchases === undefined ||
      cashAdvance === undefined ||
      otherDebits === undefined ||
      totalDue === undefined
    ) {
      continue;
    }
    return {
      previousBalanceMinor: previous,
      paymentsMinor: payments,
      creditsMinor: credits,
      purchasesMinor: purchases,
      cashAdvanceMinor: cashAdvance,
      otherDebitsMinor: otherDebits,
      totalDueMinor: totalDue,
    };
  }
  throw new ParseError(ID, 'The account summary equation did not hold seven amounts.');
}

/* ── cashback block ──────────────────────────────────────────────────────── */

function readCashback(lines: StatementLine[]): {
  earnedMinor: number;
  creditedMinor: number;
} {
  // "CASHBACK EARNED" is also a column heading in the transaction table, so
  // match the dedicated block: the only line carrying both labels.
  const labelIndex = lines.findIndex(
    (line) => /cashback earned/i.test(line.text) && /cashback credited/i.test(line.text),
  );
  if (labelIndex === -1) return { earnedMinor: 0, creditedMinor: 0 };
  for (let offset = 1; offset <= 3; offset += 1) {
    const line = lines[labelIndex + offset];
    if (!line) continue;
    const amounts = line.cells
      .map((cell) => parseAmountToMinor(cell))
      .filter((value): value is number => value !== null);
    const earned = amounts[0];
    if (earned === undefined) continue;
    return { earnedMinor: earned, creditedMinor: amounts[1] ?? 0 };
  }
  return { earnedMinor: 0, creditedMinor: 0 };
}

/* ── transaction rows ────────────────────────────────────────────────────── */

const ROW_DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const AMOUNT_WITH_SUFFIX = /^([\d,]+\.\d{2})\s*(Dr|Cr)$/i;

function readTransactions(
  input: ParserInput,
  warnings: ParseWarning[],
): { transactions: ParsedTransaction[]; skippedPages: number[] } {
  const page1 = input.lines.filter((line) => line.pageNumber === 1);

  const headerIndex = page1.findIndex(
    (line) => /^DATE$/i.test(line.cells[0] ?? '') && /transaction details/i.test(line.text),
  );
  if (headerIndex === -1) throw new ParseError(ID, 'Could not find the transaction table header.');

  const endIndex = page1.findIndex(
    (line, index) => index > headerIndex && /end of statement/i.test(line.text),
  );
  const body = page1.slice(headerIndex + 1, endIndex === -1 ? undefined : endIndex);

  const transactions: ParsedTransaction[] = [];
  for (const line of body) {
    const dateCell = (line.cells[0] ?? '').trim();
    if (!ROW_DATE.test(dateCell)) continue;
    const date = parseSlashDate(dateCell);
    if (!date) continue;

    const rest = line.cells.slice(1).filter((cell) => cell.length > 0);
    const parsed = readRow(date, rest);
    if (parsed) transactions.push(parsed);
    else {
      warnings.push({
        code: 'row_unreadable',
        message: `A row dated ${dateCell} did not hold a readable amount and was skipped.`,
      });
    }
  }

  // Any page other than the first with no dated rows is the schedule of
  // charges. It is reported, never parsed.
  const skippedPages = [
    ...new Set(input.lines.filter((line) => line.pageNumber !== 1).map((line) => line.pageNumber)),
  ];

  return { transactions, skippedPages };
}

function readRow(date: string, cells: string[]): ParsedTransaction | null {
  // From the right: cashback, then amount. Both carry a Dr/Cr suffix.
  const suffixed: Array<{ index: number; minor: number; suffix: 'dr' | 'cr' }> = [];
  cells.forEach((cell, index) => {
    const match = cell.match(AMOUNT_WITH_SUFFIX);
    if (!match) return;
    const minor = parseAmountToMinor(match[1] ?? '');
    const suffix = (match[2] ?? '').toLowerCase();
    if (minor === null || (suffix !== 'dr' && suffix !== 'cr')) return;
    suffixed.push({ index, minor, suffix });
  });

  const amountCell = suffixed[0];
  if (!amountCell) return null;
  const cashbackCell = suffixed[1];

  const descriptionCells = cells.slice(0, amountCell.index);
  const descriptionRaw = (descriptionCells[0] ?? '').trim();
  if (descriptionRaw.length === 0) return null;

  // The merchant category column only appears on merchant rows; fees and
  // payments print nothing there, which is itself a useful signal.
  const issuerCategory = descriptionCells.length > 1 ? (descriptionCells[1] ?? '').trim() : null;

  const direction = amountCell.suffix === 'cr' ? 'credit' : 'debit';
  const kind = classify(descriptionRaw, direction);

  return {
    date,
    descriptionRaw,
    counterparty: kind.counterparty,
    merchant: kind.merchant,
    issuerCategory: issuerCategory && issuerCategory.length > 0 ? issuerCategory : null,
    amountMinor: Math.abs(amountCell.minor),
    direction,
    mode: kind.mode,
    referenceNo: kind.reference,
    balanceAfterMinor: null,
    // The cashback column prints `0.00 Dr` on credit rows, which is not
    // cashback at all — only a `Cr` there is.
    cashbackMinor:
      cashbackCell && cashbackCell.suffix === 'cr' ? Math.abs(cashbackCell.minor) : null,
    isFee: kind.isFee,
    isInterest: kind.isInterest,
    isPayment: kind.isPayment,
  };
}

const FEE_ROW =
  /^(?:DCC MARKUP|GST|.*\bMARKUP FEE\b|.*\bSURCHARGE\b|.*\bLATE PAYMENT\b|.*\bANNUAL FEE\b|.*\bOVER ?LIMIT\b)/i;
const INTEREST_ROW = /\b(?:FINANCE CHARGE|INTEREST CHARGED?)\b/i;
const PAYMENT_ROW = /\b(?:BBPS PAYMENT RECEIVED|PAYMENT RECEIVED|AUTO ?DEBIT|NEFT CR)\b/i;
const CASHBACK_ROW = /\bCASHBACK CREDIT\b/i;
const CARD_ROW = /\b(?:RUPAY PURCHASE|POS|ECOM|E-COM)\b/i;
/** `UPI/<merchant>/<handle>/<ref>` */
const UPI_ROW = /^UPI\/([^/]+)\/([^/]*)\/?(.*)$/i;

function classify(
  description: string,
  direction: 'debit' | 'credit',
): {
  merchant: string;
  counterparty: string;
  mode: ParsedTransaction['mode'];
  reference: string | null;
  isFee: boolean;
  isInterest: boolean;
  isPayment: boolean;
} {
  const upi = description.match(UPI_ROW);
  if (upi) {
    const merchant = titleise((upi[1] ?? '').trim());
    return {
      merchant,
      counterparty: merchant,
      mode: 'upi',
      reference: (upi[3] ?? '').trim() || null,
      isFee: false,
      isInterest: false,
      isPayment: false,
    };
  }

  if (INTEREST_ROW.test(description)) {
    return {
      merchant: 'Interest charged',
      counterparty: '',
      mode: 'fee',
      reference: null,
      isFee: true,
      isInterest: true,
      isPayment: false,
    };
  }

  if (FEE_ROW.test(description)) {
    return {
      merchant: titleise(description),
      counterparty: '',
      mode: 'fee',
      reference: null,
      isFee: true,
      isInterest: false,
      isPayment: false,
    };
  }

  if (PAYMENT_ROW.test(description)) {
    const reference = description.split('-').slice(1).join('-').trim();
    return {
      merchant: 'Payment received',
      counterparty: '',
      mode: 'payment',
      reference: reference.length > 0 ? reference : null,
      isFee: false,
      isInterest: false,
      isPayment: true,
    };
  }

  if (CASHBACK_ROW.test(description)) {
    return {
      merchant: 'Cashback credited',
      counterparty: '',
      mode: 'other',
      reference: null,
      isFee: false,
      isInterest: false,
      isPayment: false,
    };
  }

  if (CARD_ROW.test(description)) {
    return {
      merchant: titleise(description),
      counterparty: '',
      mode: 'card',
      reference: null,
      isFee: false,
      isInterest: false,
      isPayment: false,
    };
  }

  return {
    merchant: titleise(description),
    counterparty: '',
    mode: direction === 'credit' ? 'other' : 'card',
    reference: null,
    isFee: false,
    isInterest: false,
    isPayment: false,
  };
}

/**
 * `SRI CHAKRA TEX` → `Sri Chakra Tex`. Shouting merchants read badly in a table.
 * Acronyms stay as they are: "Gst" and "Dcc Markup" look like mistakes.
 */
const ACRONYMS = new Set([
  'GST',
  'DCC',
  'UPI',
  'IMPS',
  'NEFT',
  'RTGS',
  'ATM',
  'EMI',
  'POS',
  'BBPS',
]);

export function titleise(value: string): string {
  return value
    .split(/(\s+|\/)/)
    .map((part) => {
      if (!/^[A-Za-z]/.test(part)) return part;
      if (ACRONYMS.has(part.toUpperCase())) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('')
    .trim();
}

function amountsOnLine(text: string): number[] {
  const matches = text.match(/\b[\d,]+\.\d{2}\b/g) ?? [];
  return matches
    .map((token) => parseAmountToMinor(token))
    .filter((value): value is number => value !== null);
}
