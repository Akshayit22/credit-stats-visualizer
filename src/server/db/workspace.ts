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
