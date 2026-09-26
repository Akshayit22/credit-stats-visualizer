import { PageError, PageLoading } from '../components/page-state';
import { useOverview } from '../hooks/queries';
import { useViewQuery } from '../hooks/use-view-query';
import { OverviewScreen } from '../screens/overview-screen';

export function OverviewPage() {
  const view = useOverview(useViewQuery());

  if (view.isPending) return <PageLoading />;
  if (view.isError) return <PageError error={view.error} onRetry={() => void view.refetch()} />;

  const { accounts, statements, needsReview, months, window } = view.data;
  return (
    <OverviewScreen
      accounts={accounts}
      statements={statements}
      months={months}
      availablePeriods={window.periods}
      selectedPeriod={window.selected}
      mode={window.mode}
      needsReview={needsReview}
    />
  );
}
