import { parseAmountToMinor } from '@/shared/money';
import type { StatementLine } from '@/shared/statement-text';
import type { ParseWarning } from '@/shared/types';
import { redactFreeText } from '@/shared/redact';
import { parseSpacedDate } from '@/server/domain/dates';
import type { ParsedTransaction } from '@/server/domain/schemas';
import { ParseError, type ParserInput, type ParserOutput, type StatementParser } from '../types';

const ID = 'scb-savings';

/**
 * Standard Chartered — savings account statement.
 *
 * Layout facts this parser depends on:
 *
 * - **The summary is the first and last rows of the table itself.** There is
 *   no summary strip: `BALANCE FORWARD` opens it and carries the opening
 *   balance, and a `Total` row closes it with the deposits, the withdrawals
 *   and the closing balance. The `Total` row is also what marks the end of the
 *   transactions, so it is worth finding for two reasons.
 *
 * - **The period is not printed as a range.** `STATEMENT DATE` gives the end,
 *   and the `BALANCE FORWARD` row is dated with the start.
 *
 * - **Continuation lines follow their row**, rather than being centred on it
 *   the way IDFC does it. Every single-cell line after a transaction belongs
 *   to that transaction until the next dated row begins.
 *
 * - **They are separate fields, not one hard-wrapped string**, which is why
 *   they are joined with a space here and with nothing at all in the slice and
 *   IDFC parsers. `ACME PAYROLL PRIVATE` and `LIMITED STANDARD CHARTE`
 *   are two lines of a payer's name broken at a space; running them together
 *   would give `PRIVATELIMITED`.
 *
 * - **Deposits and withdrawals are separate columns and an empty one is not
 *   printed**, so a row arrives with the amount in no fixed position and
 *   nothing saying which way it went. Direction comes from the running balance
 *   moving, which is checked against the amount on every row.
 */
export const scbSavingsParser: StatementParser = {
  id: ID,
  parse(input: ParserInput): ParserOutput {
    const warnings: ParseWarning[] = [];

    const account = readAccount(input.lines);
    const summary = readSummary(input.lines);
    const transactions = readTransactions(input.lines, summary.openingMinor, warnings);

    if (transactions.length === 0) {
      throw new ParseError(ID, 'No transaction rows were found between BALANCE FORWARD and Total.');
    }

    const interestMinor = transactions
      .filter((txn) => txn.isInterest)
      .reduce((total, txn) => total + txn.amountMinor, 0);

    return {
      warnings,
      statement: {
        accountType: 'savings',
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
        statementDate: summary.periodEnd,
        dueDate: null,
        account: {
          type: 'savings',
          issuer: input.detection.issuer || 'Standard Chartered',
          productName: input.detection.productName || 'Savings account',
          last4: account.last4,
          maskedNumber: account.maskedNumber,
          creditLimitMinor: null,
          cashLimitMinor: null,
          openedAt: null,
        },
        savings: {
          openingBalanceMinor: summary.openingMinor,
          // The interest is a row inside the Deposits total, and reconciliation
          // adds credits and interest together. Leaving it in both places makes
          // the statement short by exactly the interest it earned.
          totalCreditsMinor: summary.creditsMinor - interestMinor,
          totalDebitsMinor: summary.debitsMinor,
          interestEarnedMinor: interestMinor,
          closingBalanceMinor: summary.closingMinor,
          generatedAt: summary.periodEnd,
        },
        transactions,
      },
    };
  },
};

/* ── header and summary ──────────────────────────────────────────────────── */

/** `01 Nov 2025` — the only date shape this bank prints. */
const DATE_CELL = /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/;
/** A bare rupee amount. Standard Chartered prints no Dr/Cr marker at all. */
const AMOUNT_CELL = /^[\d,]+\.\d{2}$/;

interface Summary {
  periodStart: string;
  periodEnd: string;
  openingMinor: number;
  creditsMinor: number;
  debitsMinor: number;
  closingMinor: number;
}

/**
 * There is no summary strip on this statement: the figures are the first and
 * last rows of the transaction table.
 *
 *     01 Nov 2025 | 01 Nov 2025 | BALANCE FORWARD | 12.94
 *     …
 *     Total       | 99,641.63   | 99,599.50       | 55.07
 */
function readSummary(lines: StatementLine[]): Summary {
  const forward = lines.find((line) => /^balance forward$/i.test(line.cells[2] ?? ''));
  if (!forward) throw new ParseError(ID, 'Could not find the BALANCE FORWARD row.');

  const periodStart = parseSpacedDate(forward.cells[0] ?? '');
  const openingMinor = parseAmountToMinor(forward.cells[forward.cells.length - 1] ?? '');
  if (periodStart === null || openingMinor === null) {
    throw new ParseError(ID, 'The BALANCE FORWARD row carried no date or no balance.');
  }

  const total = lines.find((line) => /^total$/i.test(line.cells[0] ?? ''));
  if (!total) throw new ParseError(ID, 'Could not find the Total row that closes the table.');

  const amounts = total.cells
    .slice(1)
    .map((cell) => parseAmountToMinor(cell))
    .filter((value): value is number => value !== null);
  const [credits, debits, closing] = amounts;
  if (credits === undefined || debits === undefined || closing === undefined) {
    throw new ParseError(ID, 'The Total row did not hold deposits, withdrawals and a balance.');
  }

  return {
    periodStart,
    periodEnd: readStatementDate(lines) ?? periodStart,
    openingMinor,
    creditsMinor: credits,
    debitsMinor: debits,
    closingMinor: closing,
  };
}

/** `GHAR NO 20 | STATEMENT DATE | : | 30 Nov 2025` — the label is never first. */
function readStatementDate(lines: StatementLine[]): string | null {
  for (const line of lines.slice(0, 20)) {
    const at = line.cells.findIndex((cell) => /^statement\s+date$/i.test(cell.trim()));
    if (at === -1) continue;
    for (const cell of line.cells.slice(at + 1)) {
      const date = parseSpacedDate(cell.replace(/^:\s*/, '').trim());
      if (date !== null) return date;
    }
  }
  return null;
}

/** `ACCOUNT : XXXX8765`, or the raw number before redaction masked it. */
function readAccount(lines: StatementLine[]): { last4: string; maskedNumber: string } {
  for (const line of lines.slice(0, 24)) {
    const match = line.text.match(/\bACCOUNT\s*(?:NO\.?|NUMBER)?\s*:?\s*[X*]*(\d{4,})\b/i);
    const digits = match?.[1];
    if (digits === undefined) continue;
    const last4 = digits.slice(-4);
    return { last4, maskedNumber: `XXXX${last4}` };
  }
  throw new ParseError(ID, 'Could not find the account number line.');
}

/* ── the transaction table ───────────────────────────────────────────────── */

/** Column headers and page furniture, repeated on every sheet. */
function isNoise(line: StatementLine): boolean {
  const first = (line.cells[0] ?? '').trim();
  if (line.cells.every((cell) => cell.trim().length === 0)) return true;
  // `Value` and `Date` are the two halves of the "Value Date" column heading,
  // printed above and below the header row. Left in, they would be read as
  // continuation text belonging to whatever transaction came before.
  if (/^(?:value|date)$/i.test(first) && line.cells.length === 1) return true;
  if (/^date$/i.test(first) && /description/i.test(line.text)) return true;
  if (/\bPage\s*\d+\s*of\s*\d+\b/i.test(line.text)) return true;
  return false;
}

function isDataRow(line: StatementLine): boolean {
  return line.cells.length >= 4 && DATE_CELL.test((line.cells[0] ?? '').trim());
}

function readTransactions(
  lines: StatementLine[],
  openingMinor: number,
  warnings: ParseWarning[],
): ParsedTransaction[] {
  const start = lines.findIndex((line) => /^balance forward$/i.test(line.cells[2] ?? ''));
  const endOffset = lines.slice(start + 1).findIndex((line) => /^total$/i.test(line.cells[0] ?? ''));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;

  const rows = lines.slice(start + 1, end).filter((line) => !isNoise(line));

  let runningMinor = openingMinor;
  const out: ParsedTransaction[] = [];
  let current: { line: StatementLine; detail: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    const transaction = toTransaction(current.line, current.detail, runningMinor, warnings);
    current = null;
    if (!transaction) return;
    runningMinor = transaction.balanceAfterMinor ?? runningMinor;
    out.push(transaction);
  };

  for (const line of rows) {
    if (isDataRow(line)) {
      flush();
      current = { line, detail: [] };
      continue;
    }
    // Anything else below a dated row is the rest of that row's description.
    if (current) current.detail.push(line.cells.join(' ').trim());
  }
  flush();

  return out;
}

function toTransaction(
  line: StatementLine,
  detail: string[],
  previousMinor: number,
  warnings: ParseWarning[],
): ParsedTransaction | null {
  const cells = line.cells.map((cell) => cell.trim());
  const balanceMinor = parseAmountToMinor(cells[cells.length - 1] ?? '');
  if (balanceMinor === null) return null;

  // The amount is the money cell to the left of the balance. A row with only
  // one amount on it is a balance and nothing else — the opening marker.
  let amountMinor: number | null = null;
  for (let i = cells.length - 2; i >= 2; i -= 1) {
    const cell = cells[i] ?? '';
    if (!AMOUNT_CELL.test(cell)) continue;
    amountMinor = parseAmountToMinor(cell);
    break;
  }
  if (amountMinor === null || amountMinor <= 0) return null;

  const date = parseSpacedDate(cells[0] ?? '');
  if (date === null) return null;

  // The description column, then its continuation lines. They are separate
  // fields broken at spaces, not one hard-wrapped string, so they take a
  // separator — unlike every other parser here.
  const head = cells[2] ?? '';
  const description = redactFreeText([head, ...detail].join(' ').replace(/\s+/g, ' ').trim()).slice(
    0,
    400,
  );
  if (description.length === 0) return null;

  const delta = balanceMinor - previousMinor;
  const direction = delta < 0 ? 'debit' : 'credit';
  if (Math.abs(delta) !== amountMinor) {
    warnings.push({
      code: 'running_balance_mismatch',
      message: `A row dated ${date} moved the balance by a different amount than it states.`,
    });
  }

  const interest = /credit\s+interest/i.test(description);
  const fee = /\bIGST\b|\bGST\b|\bCHARGE(?:S)?\b|DECLINE/i.test(description);

  return {
    date,
    descriptionRaw: description,
    counterparty: counterpartyOf(description),
    merchant: interest ? 'Interest credited' : counterpartyOf(description),
    issuerCategory: null,
    amountMinor,
    direction,
    mode: interest ? 'interest' : modeOf(description, fee),
    referenceNo: null,
    balanceAfterMinor: balanceMinor,
    cashbackMinor: null,
    isFee: fee && !interest,
    isInterest: interest,
    isPayment: false,
  };
}

function modeOf(description: string, fee: boolean): ParsedTransaction['mode'] {
  if (/^UPI\b/i.test(description)) return 'upi';
  if (/ATM|POS\b|DEBIT CARD/i.test(description)) return 'card';
  if (fee) return 'fee';
  return 'other';
}

/** A reference this bank prints beside the payer, which is never a name. */
const REFERENCE = /^(?:BT|NEFT|IMPS|RTGS|UPI|IN1BT\w+|\d[\d-]*|CONCUR|SAL|EOPS)$/i;
/**
 * A long word mixing letters and digits — `SCBREF0001`, `REF90002`.
 * Banks build these by gluing a code to a date, and no person or company is
 * named like one, so it ends a counterparty rather than joining it.
 */
const CODE_LIKE = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{8,}$/;

/**
 * Who the money moved to or from.
 *
 * A salary credit reads `BT REF90001 ACME PAYROLL PRIVATE
 * LIMITED STANDARD CHARTE REF90001 CONCUR 257` — the payer's name sits
 * between two copies of the transfer reference. A UPI row puts the
 * counterparty first instead. Either way the name is the first run of words
 * that are words rather than references, so that is what is taken.
 */
function counterpartyOf(description: string): string {
  const words = description.split(/[\s/,]+/).filter((word) => word.length > 0);
  const name: string[] = [];
  for (const word of words) {
    if (REFERENCE.test(word) || CODE_LIKE.test(word)) {
      if (name.length > 0) break;
      continue;
    }
    if (/^\[[a-z-]+\]$/i.test(word)) {
      if (name.length > 0) break;
      continue;
    }
    if (!/[A-Za-z]/.test(word)) {
      if (name.length > 0) break;
      continue;
    }
    name.push(word);
    // Four words is a company name; the fifth is the receiving bank this
    // statement appends to every transfer (`… LIMITED STANDARD CHARTE`).
    if (name.length === 4) break;
  }
  return name.join(' ').slice(0, 200);
}
