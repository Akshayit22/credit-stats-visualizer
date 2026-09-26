import { PageError, PageLoading } from '../components/page-state';
import { useSettings } from '../hooks/queries';
import { SettingsScreen } from '../screens/settings-screen';

export function SettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <PageLoading />;
  if (settings.isError) {
    return <PageError error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  return <SettingsScreen {...settings.data} />;
}
