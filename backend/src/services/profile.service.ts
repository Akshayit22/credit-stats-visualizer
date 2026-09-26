import { Injectable } from '@nestjs/common';
import type { ProfileDeleted, ProfileExport, SettingsView } from '@cred-stats/shared';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { CategoryRulesRepository } from '../repositories/category-rules.repository.js';
import { StatementsRepository } from '../repositories/statements.repository.js';
import { SummariesRepository } from '../repositories/summaries.repository.js';
import { TransactionsRepository } from '../repositories/transactions.repository.js';
import { UsersRepository } from '../repositories/users.repository.js';
import { LlmService } from './llm.service.js';
import { LogService, userIdLogPrefix } from './log.service.js';

/** What a person can see and do about their own data as a whole. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly users: UsersRepository,
    private readonly rules: CategoryRulesRepository,
    private readonly accounts: AccountsRepository,
    private readonly statements: StatementsRepository,
    private readonly transactions: TransactionsRepository,
    private readonly summaries: SummariesRepository,
    private readonly llm: LlmService,
    private readonly log: LogService,
  ) {}

  async settings(userId: string, fallbackEmail: string): Promise<SettingsView> {
    const [profile, accounts, statements] = await Promise.all([
      this.users.get(userId),
      this.accounts.list(userId),
      this.statements.list(userId),
    ]);
    return {
      email: profile?.email ?? fallbackEmail,
      currency: profile?.currency ?? 'INR',
      locale: profile?.locale ?? 'en-IN',
      statementCount: statements.length,
      accountCount: accounts.length,
      // Read-only, from the environment: an API key is never a user setting.
      provider: this.llm.describeProvider(),
    };
  }

  /**
   * Everything held about this user, as one JSON document. There are no PDFs
   * in it because there are no PDFs: the export is the whole of what is kept.
   */
  async export(userId: string): Promise<ProfileExport> {
    const [profile, accounts, statements, transactions, summaries, rules] = await Promise.all([
      this.users.get(userId),
      this.accounts.list(userId),
      this.statements.list(userId),
      this.transactions.listAll(userId),
      this.summaries.listAll(userId),
      this.rules.list(userId),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      note: 'Statement PDFs were never stored. This is everything cred-stats holds.',
      profile,
      accounts,
      statements,
      transactions,
      summaries,
      categoryRules: rules.map(({ merchant, category }) => ({ merchant, category })),
    };
  }

  /**
   * Removes every document belonging to this user, across every collection.
   * Derived data goes first, the profile last, so an interruption never leaves
   * a profile pointing at data that is already gone.
   */
  async deleteEverything(userId: string): Promise<ProfileDeleted> {
    const deleted = {
      summaries: await this.summaries.deleteAllForUser(userId),
      transactions: await this.transactions.deleteAllForUser(userId),
      statements: await this.statements.deleteAllForUser(userId),
      accounts: await this.accounts.deleteAllForUser(userId),
      categoryRules: await this.rules.deleteAllForUser(userId),
      profile: await this.users.deleteAllForUser(userId),
    };
    this.log.warn('profile.deleted', { user: userIdLogPrefix(userId), ...deleted });
    return { deleted };
  }
}
