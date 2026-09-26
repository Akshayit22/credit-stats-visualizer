import { PageError, PageLoading } from '../components/page-state';
import { useLibrary } from '../hooks/queries';
import { LibraryScreen } from '../screens/library-screen';

export function LibraryPage() {
  const library = useLibrary();

  if (library.isPending) return <PageLoading />;
  if (library.isError) {
    return <PageError error={library.error} onRetry={() => void library.refetch()} />;
  }
  return <LibraryScreen statements={library.data.statements} accounts={library.data.accounts} />;
}
