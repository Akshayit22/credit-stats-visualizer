import { requireSessionUser } from '@/server/auth/session';
import { loadWorkspace } from '@/server/db/workspace';
import { LibraryScreen } from '@/client/screens/library-screen';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const user = await requireSessionUser();
  const workspace = await loadWorkspace(user.userId);

  return (
    <LibraryScreen
      statements={workspace.statements}
      accounts={workspace.accounts}
    />
  );
}
