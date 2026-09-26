import type { AccountView } from '@cred-stats/shared';
import { useParams } from 'react-router';
import { PageError, PageLoading } from '../components/page-state';
import { useAccountView } from '../hooks/queries';
import { useViewQuery } from '../hooks/use-view-query';
import { CardScreen } from '../screens/card-screen';
import { CashbackScreen } from '../screens/cashback-screen';
import { SavingsScreen } from '../screens/savings-screen';
import type { AccountScreen } from '../services/endpoints';

/**
 * `/accounts/:accountId`, `/accounts/:accountId/cashback` and
 * `/savings/:accountId`. One view request per screen; the API refuses the
 * wrong kind of account for a screen with a 404.
 */
export function AccountPage({ screen }: { screen: AccountScreen }) {
  const { accountId = '' } = useParams();
  const view = useAccountView(screen, accountId, useViewQuery());

  if (view.isPending) return <PageLoading />;
  if (view.isError) return <PageError error={view.error} onRetry={() => void view.refetch()} />;

  return <AccountScreenFor screen={screen} view={view.data} />;
}

function AccountScreenFor({ screen, view }: { screen: AccountScreen; view: AccountView }) {
  const window = {
    availablePeriods: view.window.periods,
    periodsWithData: view.periodsWithData,
    selectedPeriod: view.window.selected,
    mode: view.window.mode,
  };
  const card = view.statement?.accountType === 'credit_card' ? view.statement : null;
  const savings = view.statement?.accountType === 'savings' ? view.statement : null;

  switch (screen) {
    case 'card':
      return (
        <CardScreen
          account={view.account}
          statement={card}
          statements={view.statements}
          transactions={view.transactions}
          summaries={view.summaries}
          {...window}
        />
      );
    case 'cashback':
      return (
        <CashbackScreen
          account={view.account}
          statement={card}
          transactions={view.transactions}
          summaries={view.summaries}
          {...window}
        />
      );
    case 'savings':
      return (
        <SavingsScreen
          account={view.account}
          statement={savings}
          statements={view.statements}
          transactions={view.transactions}
          summaries={view.summaries}
          {...window}
        />
      );
  }
}
