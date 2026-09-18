import { ERRORS, ok, withUser } from '@/server/api/respond';
import { logger } from '@/server/log';
import { userIdLogPrefix } from '@/server/auth/user-id';
import { deleteAllAccounts } from '@/server/db/repositories/accounts';
import { deleteAllStatements } from '@/server/db/repositories/statements';
import { deleteAllSummaries } from '@/server/db/repositories/summaries';
import { deleteAllTransactions } from '@/server/db/repositories/transactions';
import { deleteAllUserItems } from '@/server/db/repositories/users';

export const dynamic = 'force-dynamic';

/**
 * Removes every item belonging to this user across all five tables. The order
 * runs from the derived data inwards, so an interruption never leaves the
 * profile pointing at data that is already gone.
 *
 * Irreversible, so it requires an explicit confirmation in the body rather than
 * happening on a bare POST.
 */
export const POST = withUser(async (user, request) => {
  const body = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== 'delete my data') {
    return ERRORS.badRequest('Send {"confirm":"delete my data"} to confirm. This cannot be undone.');
  }

  const summaries = await deleteAllSummaries(user.userId);
  const transactions = await deleteAllTransactions(user.userId);
  const statements = await deleteAllStatements(user.userId);
  const accounts = await deleteAllAccounts(user.userId);
  const profile = await deleteAllUserItems(user.userId);

  logger.warn('account.deleted', {
    user: userIdLogPrefix(user.userId),
    summaries,
    transactions,
    statements,
    accounts,
    profile,
  });

  return ok({ deleted: { summaries, transactions, statements, accounts, profile } });
});
