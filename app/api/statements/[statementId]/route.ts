import { ERRORS, ok } from '@/server/api/respond';
import { getSessionUser } from '@/server/auth/session';
import { logger } from '@/server/log';
import { userIdLogPrefix } from '@/server/auth/user-id';
import { deleteStatement, getStatement } from '@/server/db/repositories/statements';
import {
  deleteTransactionsForStatement,
  listTransactionsForStatement,
} from '@/server/db/repositories/transactions';
import { bumpStatementCount } from '@/server/db/repositories/users';
import { recomputeSummaries } from '@/server/domain/ingest';

export const dynamic = 'force-dynamic';

/**
 * `statementId` is `<accountId>_<period>`, which is all the key we need — no
 * lookup, and no way to address someone else's row, because the partition key
 * is always the caller's own user id.
 */
function splitId(statementId: string): { accountId: string; period: string } | null {
  const separator = statementId.lastIndexOf('_');
  if (separator <= 0) return null;
  const accountId = statementId.slice(0, separator);
  const period = statementId.slice(separator + 1);
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  return { accountId, period };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ statementId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return ERRORS.unauthorised();

  const { statementId } = await context.params;
  const parts = splitId(statementId);
  if (!parts) return ERRORS.badRequest('That is not a statement id.');

  const statement = await getStatement(user.userId, parts.accountId, parts.period);
  if (!statement) return ERRORS.notFound('That statement');

  const transactions = await listTransactionsForStatement(user.userId, statementId);
  return ok({ statement, transactions });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ statementId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return ERRORS.unauthorised();

  const { statementId } = await context.params;
  const parts = splitId(statementId);
  if (!parts) return ERRORS.badRequest('That is not a statement id.');

  const statement = await getStatement(user.userId, parts.accountId, parts.period);
  if (!statement) return ERRORS.notFound('That statement');

  // Rows first: a statement without its rows is recoverable, rows without their
  // statement are orphans nothing would ever clean up.
  const removed = await deleteTransactionsForStatement(user.userId, statementId);
  await deleteStatement(user.userId, parts.accountId, parts.period);
  await bumpStatementCount(user.userId, -1);
  await recomputeSummaries(user.userId, [parts.period], parts.accountId);

  logger.info('statement.deleted', {
    user: userIdLogPrefix(user.userId),
    period: parts.period,
    rows: removed,
  });

  return ok({ deleted: true, rowsRemoved: removed });
}
