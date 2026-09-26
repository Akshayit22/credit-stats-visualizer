import { Injectable } from '@nestjs/common';
import type {
  Category,
  StatementDeleted,
  StatementDetail,
  StatementLibrary,
} from '@cred-stats/shared';
import { periodOfStatementId } from '../domain/identifiers.js';
import { ApiException } from '../filters/api-exception.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { CategoryRulesRepository } from '../repositories/category-rules.repository.js';
import { StatementsRepository } from '../repositories/statements.repository.js';
import { TransactionsRepository } from '../repositories/transactions.repository.js';
import { UsersRepository } from '../repositories/users.repository.js';
import { LogService, userIdLogPrefix } from './log.service.js';
import { SummaryService } from './summary.service.js';

/** The statement library and the changes a user can make to what is stored. */
@Injectable()
export class StatementsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly statements: StatementsRepository,
    private readonly transactions: TransactionsRepository,
    private readonly users: UsersRepository,
    private readonly rules: CategoryRulesRepository,
    private readonly summaries: SummaryService,
    private readonly log: LogService,
  ) {}

  /** Every statement, newest first, with the accounts that name them. */
  async library(userId: string): Promise<StatementLibrary> {
    const [statements, accounts] = await Promise.all([
      this.statements.list(userId),
      this.accounts.list(userId),
    ]);
    return { statements, accounts };
  }

  async detail(userId: string, statementId: string): Promise<StatementDetail> {
    const statement = await this.statements.get(userId, statementId);
    if (!statement) throw ApiException.notFound('That statement');
    return {
      statement,
      transactions: await this.transactions.listForStatement(userId, statementId),
    };
  }

  async delete(userId: string, statementId: string): Promise<StatementDeleted> {
    const statement = await this.statements.get(userId, statementId);
    if (!statement) throw ApiException.notFound('That statement');

    // Rows first: a statement without its rows is recoverable; rows without
    // their statement are orphans nothing would ever clean up.
    const rowsRemoved = await this.transactions.deleteForStatement(userId, statementId);
    await this.statements.delete(userId, statementId);
    await this.users.bumpStatementCount(userId, -1);
    await this.summaries.recompute(userId, [statement.period], statement.accountId);

    this.log.info('statement.deleted', {
      user: userIdLogPrefix(userId),
      period: statement.period,
      rows: rowsRemoved,
    });
    return { deleted: true, rowsRemoved };
  }

  /**
   * Moves one row to another category. By default it also writes a rule for
   * the row's merchant, so the same merchant lands in the same place on every
   * future statement — the behaviour the review step promises.
   */
  async recategorise(
    userId: string,
    statementId: string,
    txnId: string,
    change: { category: Category; applyToMerchant: boolean },
  ): Promise<{ updated: true }> {
    const row = await this.transactions.get(userId, statementId, txnId);
    if (!row) throw ApiException.notFound('That transaction');

    await this.transactions.recategorise(userId, statementId, txnId, change.category);

    const merchant = row.merchant || row.counterparty;
    const ruleWritten = change.applyToMerchant && merchant.length > 0;
    if (ruleWritten) await this.rules.put(userId, merchant, change.category);

    // The month to recompute is the row's statement, not the month its date
    // falls in — a card cycle straddles two, and the row belongs to the cycle.
    const period = periodOfStatementId(statementId) ?? row.date.slice(0, 7);
    await this.summaries.recompute(userId, [period], row.accountId);

    this.log.info('transaction.recategorised', {
      user: userIdLogPrefix(userId),
      category: change.category,
      ruleWritten,
    });
    return { updated: true };
  }
}
