import { Controller, Get, Query } from '@nestjs/common';
import {
  ALL_ACCOUNTS_SCOPE,
  summariesQuerySchema,
  transactionsQuerySchema,
  type Account,
  type SessionUser,
  type Summary,
  type Transaction,
} from '@cred-stats/shared';
import type { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { SummariesRepository } from '../repositories/summaries.repository.js';
import { TransactionsRepository } from '../repositories/transactions.repository.js';

/**
 * The stored data as plain lists — for scripts, exports and anything that
 * wants the raw figures rather than a screen's view of them. Straight
 * repository reads, so there is no service in between.
 */
@Controller()
export class DataController {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly transactions: TransactionsRepository,
    private readonly summaries: SummariesRepository,
  ) {}

  @Get('accounts')
  async listAccounts(@CurrentUser() user: SessionUser): Promise<{ accounts: Account[] }> {
    return { accounts: await this.accounts.list(user.userId) };
  }

  /**
   *   /api/transactions?period=2026-07                 every account, one month
   *   /api/transactions?period=2026-07&accountId=…     one account, one month
   */
  @Get('transactions')
  async listTransactions(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(transactionsQuerySchema))
    query: z.output<typeof transactionsQuerySchema>,
  ): Promise<{ transactions: Transaction[]; period: string; accountId: string | null }> {
    const transactions = query.accountId
      ? await this.transactions.listForAccountPeriod(user.userId, query.accountId, query.period)
      : await this.transactions.listForPeriod(user.userId, query.period);
    return { transactions, period: query.period, accountId: query.accountId ?? null };
  }

  /**
   *   /api/summaries?year=2026                         every account added up
   *   /api/summaries?year=2026&accountId=…             one account
   */
  @Get('summaries')
  async listSummaries(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(summariesQuerySchema))
    query: z.output<typeof summariesQuerySchema>,
  ): Promise<{ summaries: Summary[]; year: string; accountId: string | null }> {
    const year = query.year ?? String(new Date().getUTCFullYear());
    const summaries = await this.summaries.list(
      user.userId,
      query.accountId ?? ALL_ACCOUNTS_SCOPE,
      year,
    );
    return { summaries, year, accountId: query.accountId ?? null };
  }
}
