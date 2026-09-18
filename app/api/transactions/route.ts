import { ERRORS, ok, withUser } from '@/server/api/respond';
import { logger } from '@/server/log';
import { userIdLogPrefix } from '@/server/auth/user-id';
import { recategoriseSchema } from '@/server/domain/schemas';
import {
  listTransactionsForAccountPeriod,
  listTransactionsForPeriod,
  recategoriseTransaction,
} from '@/server/db/repositories/transactions';
import { putUserRule } from '@/server/db/repositories/users';
import { recomputeSummaries } from '@/server/domain/ingest';

export const dynamic = 'force-dynamic';

/**
 *   /api/transactions?period=2026-07                 every account, one month
 *   /api/transactions?period=2026-07&accountId=…     one account, one month
 */
export const GET = withUser(async (user, request) => {
  const params = new URL(request.url).searchParams;
  const period = params.get('period');
  const accountId = params.get('accountId');

  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return ERRORS.badRequest('period must be YYYY-MM.');
  }

  const transactions = accountId
    ? await listTransactionsForAccountPeriod(user.userId, accountId, period)
    : await listTransactionsForPeriod(user.userId, period);

  return ok({ transactions, period, accountId: accountId ?? null });
});

/**
 * Recategorise one row. By default it also writes a user rule, so the same
 * merchant lands in the right place on every future statement — that is the
 * behaviour the design promises, and the reason rules live on the users table
 * rather than in a sixth table of their own.
 */
export const PATCH = withUser(async (user, request) => {
  const body = recategoriseSchema.parse(await request.json());

  try {
    await recategoriseTransaction(
      user.userId,
      { date: body.date, accountId: body.accountId, txnId: body.txnId },
      body.category,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return ERRORS.notFound('That transaction');
    }
    throw error;
  }

  if (body.applyToMerchant) {
    const rows = await listTransactionsForAccountPeriod(
      user.userId,
      body.accountId,
      body.date.slice(0, 7),
    );
    const edited = rows.find((row) => row.txnId === body.txnId);
    const merchant = edited?.merchant || edited?.counterparty || '';
    if (merchant.length > 0) await putUserRule(user.userId, merchant, body.category);
  }

  await recomputeSummaries(user.userId, [body.date.slice(0, 7)], body.accountId);

  logger.info('transaction.recategorised', {
    user: userIdLogPrefix(user.userId),
    category: body.category,
    ruleWritten: body.applyToMerchant,
  });

  return ok({ updated: true });
});
