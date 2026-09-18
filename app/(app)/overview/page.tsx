import { requireSessionUser } from '@/server/auth/session';
import { loadWorkspace, loadYear } from '@/server/db/workspace';
import { OverviewScreen } from '@/client/screens/overview-screen';
import { resolvePeriodWindow } from '@/server/domain/period-window';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; mode?: string; year?: string }>;
}) {
  const [params, user] = await Promise.all([searchParams, requireSessionUser()]);
  const workspace = await loadWorkspace(user.userId);
  const window = resolvePeriodWindow(workspace.periods, params);
  const summaries = await loadYear(user.userId, window.year, null);

  return (
    <OverviewScreen
      accounts={workspace.accounts}
      statements={workspace.statements}
      summaries={summaries}
      availablePeriods={window.periods}
      selectedPeriod={window.selected}
      mode={window.mode}
      needsReview={workspace.needsReview}
    />
  );
}
