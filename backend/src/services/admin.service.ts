import { Injectable } from '@nestjs/common';
import type { AdminBankCount, AdminOverview, AdminUserSummary } from '@cred-stats/shared';
import { AdminInsightsRepository } from '../repositories/admin-insights.repository.js';
import { LogService, userIdLogPrefix } from './log.service.js';

/**
 * The admin overview: every user, when they last signed in, and how many
 * statements they have uploaded for which bank. Counts only.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly insights: AdminInsightsRepository,
    private readonly log: LogService,
  ) {}

  async overview(adminUserId: string): Promise<AdminOverview> {
    const [users, counts, issuers] = await Promise.all([
      this.insights.users(),
      this.insights.statementCounts(),
      this.insights.accountIssuers(),
    ]);

    const issuerOf = new Map(issuers.map((row) => [`${row.userId}/${row.accountId}`, row.issuer]));

    const summaries: AdminUserSummary[] = users.map((user) => {
      const own = counts.filter((row) => row.userId === user.userId);

      // Two cards from one bank are one line: "Axis Bank · card · 3".
      const byBank = new Map<string, AdminBankCount>();
      for (const row of own) {
        const issuer = issuerOf.get(`${row.userId}/${row.accountId}`) || row.accountId;
        const key = `${issuer}/${row.accountType}`;
        const entry = byBank.get(key) ?? { issuer, accountType: row.accountType, statements: 0 };
        entry.statements += row.statements;
        byBank.set(key, entry);
      }

      const uploads = own.map((row) => row.lastUploadAt).sort();
      return {
        userId: user.userId,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        statements: own.reduce((total, row) => total + row.statements, 0),
        lastUploadAt: uploads.at(-1) ?? null,
        banks: [...byBank.values()].sort((a, b) => b.statements - a.statements),
      };
    });

    summaries.sort((a, b) => b.lastLoginAt.localeCompare(a.lastLoginAt));

    this.log.info('admin.overview', { admin: userIdLogPrefix(adminUserId), users: users.length });

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        users: users.length,
        statements: summaries.reduce((total, user) => total + user.statements, 0),
        accounts: issuers.length,
      },
      users: summaries,
    };
  }
}
