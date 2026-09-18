import { notFound } from 'next/navigation';
import { requireSessionUser } from '@/server/auth/session';
import { getAccount } from '@/server/db/repositories/accounts';
import {
  loadPeriod,
  loadStatementRows,
  loadWorkspace,
  loadYear,
  periodsForAccount,
  statementFor,
} from '@/server/db/workspace';
import { resolvePeriodWindow } from '@/server/domain/period-window';
import { CardScreen } from '@/client/screens/card-screen';

export const dynamic = 'force-dynamic';

export default async function CardAccountPage({
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

  // A card cycle straddles two calendar months, so the rows come from the
  // statement rather than from the month.
  const [transactions, summaries] = await Promise.all([
    statement
      ? loadStatementRows(user.userId, statement.statementId)
      : loadPeriod(user.userId, window.selected, accountId).then((data) => data.transactions),
    loadYear(user.userId, window.year, accountId),
  ]);

  return (
    <CardScreen
      account={account}
      accounts={workspace.accounts}
      statement={statement?.accountType === 'credit_card' ? statement : null}
      statements={workspace.statements}
      transactions={transactions}
      summaries={summaries}
      availablePeriods={window.periods}
      periodsWithData={withData}
      selectedPeriod={window.selected}
      mode={window.mode}
    />
  );
}
