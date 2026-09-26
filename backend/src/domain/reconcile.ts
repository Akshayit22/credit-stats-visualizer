import {
  RECONCILIATION_TOLERANCE_MINOR,
  formatMinor,
  type Reconciliation,
} from '@cred-stats/shared';
import type { ParsedStatement, ParsedTransaction } from './schemas.js';

/**
 * Reconciliation is the only thing standing between a plausible-looking parse
 * and silently wrong numbers on a dashboard. Two checks per statement kind, and
 * both must hold within ±₹1.00:
 *
 *   savings      opening + credits + interest − debits = closing
 *                …and every row's running balance chains from the one before it
 *
 *   credit card  previous − payments − credits + purchases + cash advance
 *                + other debits = total due
 *                …and the parsed rows sum to the same figure
 *
 * A failure is not an error. It marks the statement `needs_review` with a
 * sentence a person can act on, and the figures stay visible so they can be
 * corrected by hand.
 */

export function reconcile(statement: ParsedStatement): Reconciliation {
  return statement.accountType === 'savings'
    ? reconcileSavings(statement)
    : reconcileCard(statement);
}

function within(difference: number): boolean {
  return Math.abs(difference) <= RECONCILIATION_TOLERANCE_MINOR;
}

/* ── savings ─────────────────────────────────────────────────────────────── */

function reconcileSavings(
  statement: Extract<ParsedStatement, { accountType: 'savings' }>,
): Reconciliation {
  const { openingBalanceMinor, totalCreditsMinor, totalDebitsMinor, interestEarnedMinor } =
    statement.savings;
  const expected = openingBalanceMinor + totalCreditsMinor + interestEarnedMinor - totalDebitsMinor;
  const actual = statement.savings.closingBalanceMinor;
  const difference = actual - expected;

  const chain = checkBalanceChain(statement.transactions, openingBalanceMinor);

  if (!within(difference)) {
    return {
      ok: false,
      expectedMinor: expected,
      actualMinor: actual,
      differenceMinor: difference,
      message:
        `There is a ${formatMinor(Math.abs(difference))} difference between the statement's own ` +
        `summary and its closing balance. Opening plus credits and interest, less debits, comes ` +
        `to ${formatMinor(expected)}; the statement says ${formatMinor(actual)}.`,
    };
  }

  if (chain !== null) {
    return {
      ok: false,
      expectedMinor: chain.expectedMinor,
      actualMinor: chain.actualMinor,
      differenceMinor: chain.actualMinor - chain.expectedMinor,
      message:
        `There is a ${formatMinor(Math.abs(chain.actualMinor - chain.expectedMinor))} difference ` +
        `between the parsed transactions and the statement's running balance, first showing up on ` +
        `row ${chain.row} (${chain.date}). The summary totals themselves add up, so one row was ` +
        `probably read wrongly.`,
    };
  }

  return {
    ok: true,
    expectedMinor: expected,
    actualMinor: actual,
    differenceMinor: difference,
    message: 'Totals reconciled, and every row chains from the balance before it.',
  };
}

/**
 * Walks the running balance column. Returns the first row that does not follow
 * from the one before it, or null when the whole ledger chains.
 */
function checkBalanceChain(
  transactions: ParsedTransaction[],
  openingMinor: number,
): { row: number; date: string; expectedMinor: number; actualMinor: number } | null {
  let running = openingMinor;
  for (let i = 0; i < transactions.length; i += 1) {
    const txn = transactions[i];
    if (!txn) continue;
    const signed = txn.direction === 'credit' ? txn.amountMinor : -txn.amountMinor;
    running += signed;
    if (txn.balanceAfterMinor === null) continue;
    if (!within(txn.balanceAfterMinor - running)) {
      return {
        row: i + 1,
        date: txn.date,
        expectedMinor: running,
        actualMinor: txn.balanceAfterMinor,
      };
    }
    // Trust the statement's own balance from here on, so one bad row reports
    // once rather than throwing every row after it out of step too.
    running = txn.balanceAfterMinor;
  }
  return null;
}

/* ── credit card ─────────────────────────────────────────────────────────── */

function reconcileCard(
  statement: Extract<ParsedStatement, { accountType: 'credit_card' }>,
): Reconciliation {
  const card = statement.card;
  const expected =
    card.previousBalanceMinor -
    card.paymentsMinor -
    card.creditsMinor +
    card.purchasesMinor +
    card.cashAdvanceMinor +
    card.otherDebitsMinor;
  const actual = card.totalDueMinor;
  const difference = actual - expected;

  if (!within(difference)) {
    return {
      ok: false,
      expectedMinor: expected,
      actualMinor: actual,
      differenceMinor: difference,
      message:
        `There is a ${formatMinor(Math.abs(difference))} difference between the statement's own ` +
        `summary line and its total due. The summary comes to ${formatMinor(expected)}; the ` +
        `statement says ${formatMinor(actual)}.`,
    };
  }

  // The rows must reach the same total the summary does.
  const rowsDebit = sum(statement.transactions.filter((t) => t.direction === 'debit'));
  const rowsCredit = sum(statement.transactions.filter((t) => t.direction === 'credit'));
  const fromRows = card.previousBalanceMinor + rowsDebit - rowsCredit;
  const rowDifference = fromRows - actual;

  if (!within(rowDifference)) {
    return {
      ok: false,
      expectedMinor: actual,
      actualMinor: fromRows,
      differenceMinor: rowDifference,
      message:
        `There is a ${formatMinor(Math.abs(rowDifference))} difference between the parsed ` +
        `transactions and the statement's total due. The ${statement.transactions.length} rows ` +
        `we read come to ${formatMinor(fromRows)}; the statement says ${formatMinor(actual)}.`,
    };
  }

  return {
    ok: true,
    expectedMinor: expected,
    actualMinor: actual,
    differenceMinor: difference,
    message: 'Totals reconciled, and the transactions add up to the same figure.',
  };
}

function sum(transactions: ParsedTransaction[]): number {
  return transactions.reduce((total, txn) => total + txn.amountMinor, 0);
}

/**
 * Cashback earned on a card statement should equal the sum of the per-row
 * cashback column. A mismatch is worth surfacing but never blocks a save — the
 * issuer caps and adjusts cashback outside the row-level figures.
 */
export function checkCashback(
  statement: Extract<ParsedStatement, { accountType: 'credit_card' }>,
): { ok: boolean; rowsMinor: number; statedMinor: number } {
  const rowsMinor = statement.transactions.reduce(
    (total, txn) => total + (txn.cashbackMinor ?? 0),
    0,
  );
  const statedMinor = statement.card.cashbackEarnedMinor;
  return { ok: within(rowsMinor - statedMinor), rowsMinor, statedMinor };
}
