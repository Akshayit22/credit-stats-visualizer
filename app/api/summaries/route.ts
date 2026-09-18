import { ERRORS, ok, withUser } from '@/server/api/respond';
import { listSummaries } from '@/server/db/repositories/summaries';

export const dynamic = 'force-dynamic';

/**
 * The year overview is one query: `sk begins_with "ALL#2026"`, or
 * `ACCOUNT#<id>#2026` when a single account is asked for.
 *
 *   /api/summaries?year=2026
 *   /api/summaries?year=2026&accountId=axis-bank-credit-card-9581
 */
export const GET = withUser(async (user, request) => {
  const params = new URL(request.url).searchParams;
  const year = params.get('year') ?? String(new Date().getUTCFullYear());
  const accountId = params.get('accountId');

  if (!/^\d{4}$/.test(year)) return ERRORS.badRequest('year must be four digits.');

  const summaries = await listSummaries(user.userId, accountId ?? 'ALL', year);
  return ok({ summaries, year, accountId: accountId ?? null });
});
