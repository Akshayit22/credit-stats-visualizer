import { notFound } from 'next/navigation';
import { requireSessionUser } from '@/server/auth/session';
import { getAccount } from '@/server/db/repositories/accounts';
import {
  loadStatementRows,
  loadWorkspace,
  loadYear,
  periodsForAccount,
  statementFor,
} from '@/server/db/workspace';
import { resolvePeriodWindow } from '@/server/domain/period-window';
import { CashbackScreen } from '@/client/screens/cashback-screen';

export const dynamic = 'force-dynamic';

export default async function CashbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ period?: string; mode?: string; year?: string }>;
}) {
  const [{ accountId }, query, user] = await Promise.all([
    params,
    searchParams,
    requireSessionUser(),
  ]);

  const [account, workspace] = await Promise.all([
    getAccount(user.userId, accountId),
    loadWorkspace(user.userId),
  ]);
  if (!account || account.type !== 'credit_card') notFound();

  const withData = periodsForAccount(workspace, accountId);
  const window = resolvePeriodWindow(withData, query);
  const statement = statementFor(workspace, accountId, window.selected);

  const [transactions, summaries] = await Promise.all([
    statement ? loadStatementRows(user.userId, statement.statementId) : Promise.resolve([]),
    loadYear(user.userId, window.year, accountId),
  ]);

  return (
    <CashbackScreen
      account={account}
      statement={statement?.accountType === 'credit_card' ? statement : null}
      transactions={transactions}
      summaries={summaries}
      availablePeriods={window.periods}
      periodsWithData={withData}
      selectedPeriod={window.selected}
      mode={window.mode}
    />
  );
}
