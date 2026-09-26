import { Injectable } from '@nestjs/common';
import {
  ALL_ACCOUNTS_SCOPE,
  periodsForAccount,
  resolvePeriodWindow,
  type AccountType,
  type AccountView,
  type OverviewMonth,
  type OverviewView,
  type Period,
  type ViewQuery,
  type WorkspaceView,
} from '@cred-stats/shared';
import { ApiException } from '../filters/api-exception.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { StatementsRepository } from '../repositories/statements.repository.js';
import { SummariesRepository } from '../repositories/summaries.repository.js';
import { TransactionsRepository } from '../repositories/transactions.repository.js';

/** The three account screens, and the kind of account each one shows. */
export type AccountScreen = 'card' | 'savings' | 'cashback';

const ACCOUNT_TYPE_FOR: Record<AccountScreen, AccountType> = {
  card: 'credit_card',
  savings: 'savings',
  cashback: 'credit_card',
};

/**
 * Everything a screen draws, in one response. The frontend asks for a view and
 * renders it; the arithmetic about which month is selected and which rows
 * belong to it happens here, once.
 */
@Injectable()
export class ViewsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly statements: StatementsRepository,
    private readonly transactions: TransactionsRepository,
    private readonly summaries: SummariesRepository,
  ) {}

  /** Which accounts exist, which months have a statement, what needs review. */
  async workspace(userId: string): Promise<WorkspaceView> {
    const [accounts, statements] = await Promise.all([
      this.accounts.list(userId),
      this.statements.list(userId),
    ]);
    return {
      accounts,
      statements,
      periods: [...new Set(statements.map((statement) => statement.period))].sort(),
      needsReview: statements.filter((statement) => statement.status === 'needs_review'),
    };
  }

  async overview(userId: string, query: ViewQuery): Promise<OverviewView> {
    const workspace = await this.workspace(userId);
    const window = resolvePeriodWindow(workspace.periods, query);
    return {
      accounts: workspace.accounts,
      statements: workspace.statements,
      needsReview: workspace.needsReview,
      months: await this.overviewMonths(userId, window.year),
      window,
    };
  }

  /**
   * One account's screen. The rows are the selected **statement's**, not the
   * calendar month's: a card cycle running 17 May – 15 Jun has four rows dated
   * in May, and the June screen must show all of them. Only when there is no
   * statement for the month do the card and savings screens fall back to rows
   * dated in it; cashback has nothing to show without a statement.
   */
  async account(
    userId: string,
    accountId: string,
    screen: AccountScreen,
    query: ViewQuery,
  ): Promise<AccountView> {
    const [account, workspace] = await Promise.all([
      this.accounts.get(userId, accountId),
      this.workspace(userId),
    ]);
    if (!account || account.type !== ACCOUNT_TYPE_FOR[screen]) {
      throw ApiException.notFound('That account');
    }

    const periodsWithData = periodsForAccount(workspace.statements, accountId);
    const window = resolvePeriodWindow(periodsWithData, query);
    const statement =
      workspace.statements.find(
        (candidate) => candidate.accountId === accountId && candidate.period === window.selected,
      ) ?? null;

    const [transactions, summaries] = await Promise.all([
      statement
        ? this.transactions.listForStatement(userId, statement.statementId)
        : screen === 'cashback'
          ? Promise.resolve([])
          : this.transactions.listForAccountPeriod(userId, accountId, window.selected),
      this.summaries.list(userId, accountId, window.year),
    ]);

    return {
      account,
      statement,
      statements: workspace.statements,
      transactions,
      summaries,
      window,
      periodsWithData,
    };
  }

  /**
   * One row per month for the Overview, with card figures kept apart.
   *
   * Cashback and fees only exist on a credit card. Reading them off the
   * combined `ALL` summary made a month with only a savings statement look like
   * a month where the card earned nothing — a zero that is really an absence.
   */
  private async overviewMonths(userId: string, year: string): Promise<OverviewMonth[]> {
    const [accounts, all] = await Promise.all([
      this.accounts.list(userId),
      this.summaries.list(userId, ALL_ACCOUNTS_SCOPE, year),
    ]);
    const perCard = await Promise.all(
      accounts
        .filter((account) => account.type === 'credit_card')
        .map((account) => this.summaries.list(userId, account.accountId, year)),
    );

    const byPeriod = new Map<Period, OverviewMonth>();
    const monthFor = (period: Period): OverviewMonth => {
      const existing = byPeriod.get(period);
      if (existing) return existing;
      const blank: OverviewMonth = {
        period,
        spendMinor: 0,
        incomeMinor: 0,
        paymentsMinor: 0,
        cardSpendMinor: 0,
        cashbackMinor: 0,
        feesMinor: 0,
        hasAnyStatement: false,
        hasCardStatement: false,
      };
      byPeriod.set(period, blank);
      return blank;
    };

    for (const summary of all) {
      if (summary.txnCount === 0) continue;
      const month = monthFor(summary.period);
      month.spendMinor += summary.spendMinor;
      month.incomeMinor += summary.incomeMinor;
      month.paymentsMinor += summary.paymentsMinor;
      month.hasAnyStatement = true;
    }

    for (const summary of perCard.flat()) {
      if (summary.txnCount === 0) continue;
      const month = monthFor(summary.period);
      month.cardSpendMinor += summary.spendMinor;
      month.cashbackMinor += summary.cashbackEarnedMinor;
      month.feesMinor += summary.feesMinor;
      month.hasCardStatement = true;
    }

    return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  }
}
