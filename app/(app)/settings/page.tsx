import { requireSessionUser } from '@/server/auth/session';
import { getUser } from '@/server/db/repositories/users';
import { loadWorkspace } from '@/server/db/workspace';
import { describeProvider } from '@/server/llm';
import { SettingsScreen } from '@/client/screens/settings-screen';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireSessionUser();
  const [profile, workspace] = await Promise.all([
    getUser(user.userId),
    loadWorkspace(user.userId),
  ]);

  return (
    <SettingsScreen
      email={profile?.email ?? user.email}
      currency={profile?.currency ?? 'INR'}
      locale={profile?.locale ?? 'en-IN'}
      statementCount={workspace.statements.length}
      accountCount={workspace.accounts.length}
      // Read-only, and from the environment: an API key is never a user setting.
      provider={describeProvider()}
    />
  );
}
