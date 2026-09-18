import { ok, withUser } from '@/server/api/respond';
import { listAccounts } from '@/server/db/repositories/accounts';
import { listStatements } from '@/server/db/repositories/statements';
import { listSummaries } from '@/server/db/repositories/summaries';
import { listTransactionsForPeriod } from '@/server/db/repositories/transactions';
import { getUser, listUserRules } from '@/server/db/repositories/users';

export const dynamic = 'force-dynamic';

/**
 * Everything we hold about this user, as one JSON document. There are no PDFs
 * in it because there are no PDFs: the export is the whole truth of what was
 * kept.
 */
export const GET = withUser(async (user) => {
  const [profile, accounts, statements, rules] = await Promise.all([
    getUser(user.userId),
    listAccounts(user.userId),
    listStatements(user.userId),
    listUserRules(user.userId),
  ]);

  const periods = [...new Set(statements.map((statement) => statement.period))].sort();
  const years = [...new Set(periods.map((period) => period.slice(0, 4)))];

  const transactions = (
    await Promise.all(periods.map((period) => listTransactionsForPeriod(user.userId, period)))
  ).flat();

  const summaries = (
    await Promise.all(
      years.flatMap((year) => [
        listSummaries(user.userId, 'ALL', year),
        ...accounts.map((account) => listSummaries(user.userId, account.accountId, year)),
      ]),
    )
  ).flat();

  return ok(
    {
      exportedAt: new Date().toISOString(),
      note: 'Statement PDFs were never stored. This is everything cred-stats holds.',
      profile,
      accounts,
      statements,
      transactions,
      summaries,
      categoryRules: [...rules.entries()].map(([merchant, category]) => ({ merchant, category })),
    },
    {
      headers: {
        'content-disposition': `attachment; filename="cred-stats-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
      },
    },
  );
});
