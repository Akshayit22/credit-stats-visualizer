import { parseAmountToMinor } from '@/shared/money';
import type { StatementLine } from '@/shared/statement-text';
import type { ParseWarning } from '@/shared/types';
import { redactFreeText } from '@/shared/redact';
import { parseDashMonthDate, parseSpacedDate } from '@/server/domain/dates';
import type { ParsedTransaction } from '@/server/domain/schemas';
import { ParseError, type ParserInput, type ParserOutput, type StatementParser } from '../types';

const ID = 'idfc-savings';

/**
 * IDFC FIRST Bank — consolidated savings account statement.
 *
 * Layout facts this parser depends on:
 *
 * - **A transaction is a block of printed lines, not a line.** The description
 *   is a multi-line cell rendered *around* the row carrying the money, and the
 *   PDF emits it top to bottom, so one transaction reads:
 *
 *       UPI/DR/527407308477/IndianCl/I
 *       01 Oct 25 18:19 ⇥ 01 Oct 25 ⇥ 100,000.00 ⇥ 592,634.00 CR
 *       CIC/bsestar/t9iPzO8
 *
 * - **The block is vertically centred**, which is what makes it separable:
 *   a description occupying five lines puts two above the money row and two
 *   below. So the number of lines belonging *after* a row equals the number
 *   belonging *before* it, and a run of continuation lines between two rows
 *   divides without guesswork. Without this the parser cannot tell whether a
 *   line between two transactions is the tail of the first or the head of the
 *   second, and a misplaced line means a payment attributed to the wrong
 *   counterparty.
 *
 * - **Two layouts, same block.** Some statements put the date and time in one
 *   cell on the money row; others split them, dating the line above and timing
 *   the line below, with the description sharing those lines:
 *
 *       01 Dec 25 ⇥ UPI/DR/533531761152/SELF
 *       01 Dec 25 ⇥ 5,000.00 ⇥ 91,944.00 CR
 *       00:23     ⇥ L/SELFt/Pay req
 *
 *   Both are read the same way: find the row carrying the running balance,
 *   then take the dates, amounts and description from the whole block. Cell
 *   *position* is never relied on, because empty columns are simply not
 *   printed — a row with no reference number has one fewer cell than its
 *   neighbour.
 *
 * - **There is no debit/credit column that survives.** Withdrawals and
 *   deposits are separate printed columns, but an empty one is dropped, so by
 *   the time this sees the row the amount is just a number. Direction comes
 *   from the running balance moving down or up, which is stronger than a
 *   column anyway: it is checked against the amount on every row.
 *
 * - Lines are hard-wrapped mid-word (`…/AKS` + `HAY SELF`) and joined with no
 *   separator, as everywhere else in this codebase.
 */
export const idfcSavingsParser: StatementParser = {
  id: ID,
  parse(input: ParserInput): ParserOutput {
    const warnings: ParseWarning[] = [];

    const period = readPeriod(input.lines);
    const summary = readSummary(input.lines);
    const account = readAccount(input.lines);
    const transactions = readTransactions(input.lines, summary.openingMinor, warnings);

    if (transactions.length === 0) {
      throw new ParseError(ID, 'No transaction rows were found below the Date and Time header.');
    }

    const interestMinor = transactions
      .filter((txn) => txn.isInterest)
      .reduce((total, txn) => total + txn.amountMinor, 0);

    return {
      warnings,
      statement: {
        accountType: 'savings',
        periodStart: period.start,
        periodEnd: period.end,
        statementDate: period.end,
        dueDate: null,
        account: {
          type: 'savings',
          issuer: input.detection.issuer || 'IDFC FIRST Bank',
          productName: input.detection.productName || 'Savings account',
          last4: account.last4,
          maskedNumber: account.maskedNumber,
          creditLimitMinor: null,
          cashLimitMinor: null,
          openedAt: account.openedAt,
        },
        savings: {
          openingBalanceMinor: summary.openingMinor,
          // IDFC prints one Deposits total and the interest credit is a row
          // inside it, where slice gives interest its own column. Reconciliation
          // adds credits and interest together, so the interest is taken back
          // out here — otherwise every statement is short by exactly the
          // interest it earned, which is how this was found.
          totalCreditsMinor: summary.creditsMinor - interestMinor,
          totalDebitsMinor: summary.debitsMinor,
          interestEarnedMinor: interestMinor,
          closingBalanceMinor: summary.closingMinor,
          generatedAt: null,
        },
        transactions,
      },
    };
  },
};

/* ── header ──────────────────────────────────────────────────────────────── */

/** `STATEMENT PERIOD ⇥ : 01-OCT-2025 to 31-OCT-2025` */
const PERIOD = /(\d{1,2}-[A-Za-z]{3,9}-\d{4})\s+to\s+(\d{1,2}-[A-Za-z]{3,9}-\d{4})/i;

function readPeriod(lines: StatementLine[]): { start: string; end: string } {
  for (const line of lines.slice(0, 20)) {
    if (!/statement\s+period/i.test(line.text)) continue;
    const match = line.text.match(PERIOD);
    if (!match) continue;
    const start = parseDashMonthDate(match[1] ?? '');
    const end = parseDashMonthDate(match[2] ?? '');
    if (start && end) return { start, end };
  }
  throw new ParseError(ID, 'Could not read the statement period from the page header.');
}

interface Summary {
  openingMinor: number;
  creditsMinor: number;
  debitsMinor: number;
  closingMinor: number;
}

/**
 * The account summary strip:
 *
 *     Opening Balance | Number of  | Number of Deposits | Withdrawals | Deposits | Closing Balance
 *     (INR)           | Withdrawals| (INR)              | (INR)       | (INR)
 *     692,634.00 CR   | 008        | 010                | 793,732.00  | 270,845.00 | 169,747.00 CR
 *
 * The two counts sit between the amounts, so the amounts are picked out by
 * their decimal point rather than by their column: `008` is a tally of
 * withdrawals, not eight rupees, and taking it positionally would put the
 * whole strip one column out.
 */
function readSummary(lines: StatementLine[]): Summary {
  const labelIndex = lines.findIndex(
    (line) => /opening balance/i.test(line.text) && /closing balance/i.test(line.text),
  );
  if (labelIndex === -1) throw new ParseError(ID, 'Could not find the account summary strip.');

  for (let offset = 1; offset <= 3; offset += 1) {
    const line = lines[labelIndex + offset];
    if (!line) continue;
    const amounts = line.cells
      .filter((cell) => /\d\.\d{2}\b/.test(cell))
      .map((cell) => parseAmountToMinor(cell))
      .filter((value): value is number => value !== null);
    if (amounts.length < 4) continue;

    const [opening, debits, credits, closing] = amounts;
    if (
      opening === undefined ||
      debits === undefined ||
      credits === undefined ||
      closing === undefined
    ) {
      continue;
    }
    return {
      openingMinor: opening,
      debitsMinor: debits,
      creditsMinor: credits,
      closingMinor: closing,
    };
  }
  throw new ParseError(ID, 'The account summary strip did not hold four amounts.');
}

interface Account {
  last4: string;
  maskedNumber: string;
  openedAt: string | null;
}

/**
 * `SAVINGS ACCOUNT DETAILS FOR A/C : 10240951741`, or the same line once the
 * redaction pass has masked it. Both shapes end in the digits we keep.
 */
function readAccount(lines: StatementLine[]): Account {
  let last4 = '';
  let openedAt: string | null = null;

  for (const line of lines) {
    if (last4 === '') {
      const match = line.text.match(/ACCOUNT\s+DETAILS\s+FOR\s+A\/C\s*:?\s*[X*]*(\d{4,})\b/i);
      const digits = match?.[1];
      if (digits !== undefined) last4 = digits.slice(-4);
    }
    if (openedAt === null && /account\s+opening\s+date/i.test(line.cells[0] ?? '')) {
      openedAt = parseDashMonthDate(line.cells[1] ?? '');
    }
  }

  if (last4 === '') throw new ParseError(ID, 'Could not find the account number line.');
  return { last4, maskedNumber: `XXXX${last4}`, openedAt };
}

/* ── the transaction table ───────────────────────────────────────────────── */

/** The running balance, always the last cell of the row that carries money. */
const BALANCE_CELL = /^([\d,]+\.\d{2})\s*(CR|DR)$/i;
/** `01 Oct 25`, optionally with the time in the same cell. */
const DATE_CELL = /^(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})(?:\s+\d{2}:\d{2})?$/;
/** `00:23`, the other half of a split date column. */
const TIME_CELL = /^\d{1,2}:\d{2}$/;
/** Page furniture that repeats on every sheet and belongs to no transaction. */
const NOISE =
  /^(?:consolidated statement|registered office|if your aadhaar|to update, please visit|nri customers|date and time|no\.|transaction accounts|summary of your relationship)/i;

function isNoise(line: StatementLine): boolean {
  if (line.cells.every((cell) => cell.trim().length === 0)) return true;
  if (NOISE.test(line.text.trim())) return true;
  if (/^(?:customer id|statement period)$/i.test(line.cells[0] ?? '')) return true;
  if (/\bPage\s+\d+\s+of\s+\d+\b/i.test(line.text)) return true;
  return false;
}

function isAnchor(line: StatementLine): boolean {
  const last = line.cells[line.cells.length - 1] ?? '';
  if (!BALANCE_CELL.test(last)) return false;
  // The opening-balance marker and the summary strip also end in a balance.
  return !/^(?:opening|closing)\s+balance$/i.test(line.cells[0] ?? '');
}

interface Block {
  anchor: StatementLine;
  before: StatementLine[];
  after: StatementLine[];
}

/**
 * Splits the table into one block per transaction.
 *
 * The rule is the vertical centring: whatever number of continuation lines a
 * transaction has above its money row, it has the same number below. Reading
 * left to right that makes every gap divisible — the lines after a row are
 * fixed by the lines before it, and the remainder opens the next block.
 */
function blocksOf(rows: StatementLine[], warnings: ParseWarning[]): Block[] {
  const anchors: number[] = [];
  rows.forEach((line, index) => {
    if (isAnchor(line)) anchors.push(index);
  });

  const blocks: Block[] = [];
  let consumed = 0;

  anchors.forEach((anchorIndex, position) => {
    const before = Math.max(0, anchorIndex - consumed);
    const nextAnchor = anchors[position + 1] ?? rows.length;
    const room = nextAnchor - anchorIndex - 1;
    const after = Math.min(before, room);
    if (after < before) {
      warnings.push({
        code: 'layout_irregular',
        message:
          'A transaction description ran into the next row and was shortened. ' +
          'Check that statement in the app before trusting its counterparties.',
      });
    }

    const anchor = rows[anchorIndex];
    if (anchor) {
      blocks.push({
        anchor,
        before: rows.slice(anchorIndex - before, anchorIndex),
        after: rows.slice(anchorIndex + 1, anchorIndex + 1 + after),
      });
    }
    consumed = anchorIndex + 1 + after;
  });

  return blocks;
}

function tableRange(lines: StatementLine[]): { start: number; end: number } {
  const start = lines.findIndex(
    (line) => /date and time/i.test(line.text) && /transaction details/i.test(line.text),
  );
  if (start === -1) throw new ParseError(ID, 'Could not find the transaction table header.');

  const endOffset = lines
    .slice(start + 1)
    .findIndex(
      (line) =>
        /^(?:customer name|important message)$/i.test(line.cells[0] ?? '') ||
        /end of the statement/i.test(line.text),
    );
  return { start: start + 1, end: endOffset === -1 ? lines.length : start + 1 + endOffset };
}

function readTransactions(
  lines: StatementLine[],
  openingMinor: number,
  warnings: ParseWarning[],
): ParsedTransaction[] {
  const { start, end } = tableRange(lines);
  const rows = lines
    .slice(start, end)
    .filter((line) => !isNoise(line))
    .filter((line) => !/^opening\s+balance$/i.test(line.cells[0] ?? ''));

  let runningMinor = openingMinor;
  const out: ParsedTransaction[] = [];

  for (const block of blocksOf(rows, warnings)) {
    const transaction = toTransaction(block, runningMinor, warnings);
    if (!transaction) continue;
    runningMinor = transaction.balanceAfterMinor ?? runningMinor;
    out.push(transaction);
  }

  return out;
}

/** Every cell of the block, in reading order, with the anchor in the middle. */
function cellsOf(block: Block): string[] {
  return [
    ...block.before.flatMap((line) => line.cells),
    ...block.anchor.cells,
    ...block.after.flatMap((line) => line.cells),
  ].map((cell) => cell.trim());
}

function toTransaction(
  block: Block,
  previousMinor: number,
  warnings: ParseWarning[],
): ParsedTransaction | null {
  const anchorCells = block.anchor.cells.map((cell) => cell.trim());
  const balanceCell = anchorCells[anchorCells.length - 1] ?? '';
  const balanceMatch = balanceCell.match(BALANCE_CELL);
  if (!balanceMatch) return null;

  const balanceRaw = parseAmountToMinor(balanceMatch[1] ?? '');
  if (balanceRaw === null) return null;
  // A `DR` balance is an overdrawn account: the running balance is negative.
  const balanceMinor = /dr/i.test(balanceMatch[2] ?? '') ? -balanceRaw : balanceRaw;

  // The amount is the money cell immediately to the left of the balance.
  let amountMinor: number | null = null;
  for (let i = anchorCells.length - 2; i >= 0; i -= 1) {
    const cell = anchorCells[i] ?? '';
    if (!/^\(?[\d,]+\.\d{2}\)?$/.test(cell)) continue;
    amountMinor = parseAmountToMinor(cell);
    break;
  }
  if (amountMinor === null || amountMinor <= 0) return null;

  const cells = cellsOf(block);
  const dateCell = cells.find((cell) => DATE_CELL.test(cell));
  const date = dateCell ? parseSpacedDate(dateCell.slice(0, 9)) : null;
  if (!date) return null;

  // Whatever is not a date, a time, or money is the description, in the order
  // it was printed. The bank wraps mid-word, so the pieces butt together.
  const description = redactFreeText(
    cells
      .filter(
        (cell) =>
          cell.length > 0 &&
          !DATE_CELL.test(cell) &&
          !TIME_CELL.test(cell) &&
          !BALANCE_CELL.test(cell) &&
          !/^\(?[\d,]+\.\d{2}\)?$/.test(cell),
      )
      .join(''),
  ).slice(0, 400);

  if (description.length === 0) return null;

  // Direction from the balance moving, not from a column: the withdrawals and
  // deposits columns are separate, and an empty one is not printed at all.
  const delta = balanceMinor - previousMinor;
  const direction = delta < 0 ? 'debit' : 'credit';
  if (Math.abs(delta) !== amountMinor) {
    warnings.push({
      code: 'running_balance_mismatch',
      message: `A row dated ${date} moved the balance by a different amount than it states.`,
    });
  }

  const interest = /interest\s*credit/i.test(description);
  const mode = interest ? 'interest' : modeOf(description);

  return {
    date,
    descriptionRaw: description,
    counterparty: counterpartyOf(description),
    merchant: interest ? 'Interest credited' : counterpartyOf(description),
    issuerCategory: null,
    amountMinor,
    direction,
    mode,
    referenceNo: null,
    balanceAfterMinor: balanceMinor,
    cashbackMinor: null,
    isFee: false,
    isInterest: interest,
    isPayment: false,
  };
}

function modeOf(description: string): ParsedTransaction['mode'] {
  if (/^UPI\b/i.test(description)) return 'upi';
  if (/^(?:NEFT|IMPS|RTGS|FT|IFT|TPT)\b/i.test(description)) return 'other';
  if (/^(?:POS|ATM)\b/i.test(description)) return 'card';
  return 'other';
}

/**
 * The counterparty, out of IDFC's slash-separated description.
 *
 * `UPI/DR/<ref>/<name>/<bank>/<handle>/<note>` and
 * `NEFT/<ref>/<name>/<ifsc>` both put the name after the reference, so the
 * rule is the same for each: the first segment that is neither a marker, a
 * reference number, nor a mask left behind by redaction.
 */
function counterpartyOf(description: string): string {
  const segments = description.split('/').map((segment) => segment.trim());
  for (const segment of segments.slice(1)) {
    if (segment.length < 2) continue;
    if (/^(?:DR|CR|REV|REVERSAL)$/i.test(segment)) continue;
    if (/^\[[a-z-]+\]$/i.test(segment)) continue;
    if (/^\d+$/.test(segment)) continue;
    if (/^[A-Z]{2,6}\d{6,}$/i.test(segment)) continue;
    return segment.replace(/\s+/g, ' ').slice(0, 200);
  }
  return '';
}
