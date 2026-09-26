import { Injectable } from '@nestjs/common';
import { ALL_ACCOUNTS_SCOPE, type Period, type Summary } from '@cred-stats/shared';
import { aggregateSummaries, buildSummary } from '../domain/summarise.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { StatementsRepository } from '../repositories/statements.repository.js';
import { SummariesRepository } from '../repositories/summaries.repository.js';
import { TransactionsRepository } from '../repositories/transactions.repository.js';

/**
 * Keeps the monthly summaries in step with what is stored.
 *
 * Always recomputed from the stored rows, never incremented — that is what
 * makes uploading the same month twice, deleting a statement, or moving a row
 * to another category all converge on the same numbers.
 */
@Injectable()
export class SummaryService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly statements: StatementsRepository,
    private readonly transactions: TransactionsRepository,
    private readonly summaries: SummariesRepository,
  ) {}

  /**
   * Recomputes each account's summary for the given months, then the
   * across-accounts `ALL` summary as their sum.
   *
   * An account's month is its **statement**, not the calendar month. The Axis
   * cycle runs 17 May to 15 Jun, so four of its rows are dated in May; counting
   * by date would split the June bill across two months and understate both.
   */
  async recompute(userId: string, periods: Period[], accountId: string | null): Promise<void> {
    const statements = await this.statements.list(userId);

    for (const period of periods) {
      const inPeriod = statements.filter((statement) => statement.period === period);
      const accountIds = new Set(inPeriod.map((statement) => statement.accountId));
      if (accountId) accountIds.add(accountId);

      for (const id of accountIds) {
        const statement = inPeriod.find((candidate) => candidate.accountId === id);

        // No statement for this account in this month means the month is
        // empty, even if rows dated inside it exist — the June statement's
        // May-dated rows must not invent a May the user never uploaded.
        if (!statement) {
          await this.summaries.delete(userId, id, period);
          continue;
        }

        await this.summaries.put(
          userId,
          buildSummary({
            scope: id,
            period,
            transactions: await this.transactions.listForStatement(userId, statement.statementId),
            statements: [statement],
          }),
        );
      }

      // Then the month across accounts, as the sum of what each account's
      // statement said — re-read rather than reused, so summaries written by
      // earlier requests are included too.
      const accountsWithData = new Set([
        ...statements.map((statement) => statement.accountId),
        ...(await this.accounts.list(userId)).map((account) => account.accountId),
      ]);
      const year = period.slice(0, 4);
      const parts: Summary[] = [];
      for (const id of accountsWithData) {
        const match = (await this.summaries.list(userId, id, year)).find(
          (summary) => summary.period === period,
        );
        if (match && match.txnCount > 0) parts.push(match);
      }

      if (parts.length === 0) await this.summaries.delete(userId, ALL_ACCOUNTS_SCOPE, period);
      else await this.summaries.put(userId, aggregateSummaries(period, parts));
    }
  }
}
