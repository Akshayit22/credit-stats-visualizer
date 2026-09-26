import { PageError, PageLoading } from '../components/page-state';
import { useAdminOverview } from '../hooks/queries';
import { AdminScreen } from '../screens/admin-screen';

export function AdminPage() {
  const overview = useAdminOverview();

  if (overview.isPending) return <PageLoading />;
  if (overview.isError) {
    return <PageError error={overview.error} onRetry={() => void overview.refetch()} />;
  }
  return <AdminScreen overview={overview.data} />;
}
