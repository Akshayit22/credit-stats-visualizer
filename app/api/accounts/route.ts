import { ok, withUser } from '@/server/api/respond';
import { listAccounts } from '@/server/db/repositories/accounts';

export const dynamic = 'force-dynamic';

export const GET = withUser(async (user) => ok({ accounts: await listAccounts(user.userId) }));
