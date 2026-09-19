import type { Account, Period, Statement, Summary, Transaction } from '@/shared/types';
import { listAccounts } from './repositories/accounts';
import { listStatements } from './repositories/statements';
import { listSummaries } from './repositories/summaries';
import {
  listTransactionsForAccountPeriod,
  listTransactionsForPeriod,
  listTransactionsForStatement,
} from './repositories/transactions';

/**
 * What every screen needs before it can draw anything: which accounts exist,
 * which months have a statement, and what the totals were. Loaded once per
 * request in a server component and handed down, rather than fetched again from
 * each panel.
 */
export interface Workspace {
  accounts: Account[];
  statements: Statement[];
  /** Months with at least one statement, oldest first. */
  periods: Period[];
  needsReview: Statement[];
}

export async function loadWorkspace(userId: string): Promise<Workspace> {
  const [accounts, statements] = await Promise.all([
    listAccounts(userId),
    listStatements(userId),
  ]);

  const periods = [...new Set(statements.map((statement) => statement.period))].sort();

  return {
    accounts,
    statements,
    periods,
    needsReview: statements.filter((statement) => statement.status === 'needs_review'),
  };
}

export interface PeriodData {
  summary: Summary | null;
  transactions: Transaction[];
}

export async function loadPeriod(
  userId: string,
  period: Period,
  accountId: string | null,
): Promise<PeriodData> {
  const year = period.slice(0, 4);
  const [summaries, transactions] = await Promise.all([
    listSummaries(userId, accountId ?? 'ALL', year),
    accountId
      ? listTransactionsForAccountPeriod(userId, accountId, period)
      : listTransactionsForPeriod(userId, period),
  ]);

  return {
    summary: summaries.find((summary) => summary.period === period) ?? null,
    transactions: transactions.sort((a, b) =>
      a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date),
    ),
  };
}

/**
 * The rows of one statement, which is **not** the same as the rows dated in one
 * calendar month. The Axis cycle runs 17 May to 15 Jun: four of its fifteen
 * rows are dated in May, and a screen showing "the June statement" must show
 * all fifteen. That is what the transactions gsi2 is for.
 */
export async function loadStatementRows(
  userId: string,
  statementId: string,
): Promise<Transaction[]> {
  const rows = await listTransactionsForStatement(userId, statementId);
  return rows.sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date)));
}

/**
 * One row per month for the Overview, with the card figures kept apart from
 * everything else.
 *
 * Cashback and fees only exist on a credit card. Reading them off the combined
 * `ALL#<period>` summary made a month where only a savings statement was
 * uploaded look like a month where the card earned nothing — a zero that is
 * really an absence. They come from the card accounts alone, and a month with
 * no card statement carries no cashback point at all.
 */
export interface OverviewMonth {
  period: Period;
  /** Every account: what left the account or was charged to the card. */
  spendMinor: number;
  incomeMinor: number;
  paymentsMinor: number;
  /** Credit cards only. */
  cardSpendMinor: number;
  cashbackMinor: number;
  feesMinor: number;
  hasAnyStatement: boolean;
  hasCardStatement: boolean;
}

export async function loadOverviewMonths(
  userId: string,
  year: string,
): Promise<OverviewMonth[]> {
  const [accounts, all] = await Promise.all([
    listAccounts(userId),
    listSummaries(userId, 'ALL', year),
  ]);

  const cardAccounts = accounts.filter((account) => account.type === 'credit_card');
  const perCard = await Promise.all(
    cardAccounts.map((account) => listSummaries(userId, account.accountId, year)),
  );

  const byPeriod = new Map<Period, OverviewMonth>();
  const blank = (period: Period): OverviewMonth => ({
    period,
    spendMinor: 0,
    incomeMinor: 0,
    paymentsMinor: 0,
    cardSpendMinor: 0,
    cashbackMinor: 0,
    feesMinor: 0,
    hasAnyStatement: false,
    hasCardStatement: false,
  });

  for (const summary of all) {
    if (summary.txnCount === 0) continue;
    const row = byPeriod.get(summary.period) ?? blank(summary.period);
    row.spendMinor += summary.spendMinor;
    row.incomeMinor += summary.incomeMinor;
    row.paymentsMinor += summary.paymentsMinor;
    row.hasAnyStatement = true;
    byPeriod.set(summary.period, row);
  }

  for (const summaries of perCard) {
    for (const summary of summaries) {
      if (summary.txnCount === 0) continue;
      const row = byPeriod.get(summary.period) ?? blank(summary.period);
      row.cardSpendMinor += summary.spendMinor;
      row.cashbackMinor += summary.cashbackEarnedMinor;
      row.feesMinor += summary.feesMinor;
      row.hasCardStatement = true;
      byPeriod.set(summary.period, row);
    }
  }

  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export async function loadYear(
  userId: string,
  year: string,
  accountId: string | null,
): Promise<Summary[]> {
  return listSummaries(userId, accountId ?? 'ALL', year);
}

/** The months a given account has a statement for, oldest first. */
export function periodsForAccount(workspace: Workspace, accountId: string): Period[] {
  return [
    ...new Set(
      workspace.statements
        .filter((statement) => statement.accountId === accountId)
        .map((statement) => statement.period),
    ),
  ].sort();
}

export function statementFor(
  workspace: Workspace,
  accountId: string,
  period: Period,
): Statement | null {
  return (
    workspace.statements.find(
      (statement) => statement.accountId === accountId && statement.period === period,
    ) ?? null
  );
}
