import { Sidebar, type NavLink } from '@/client/components/sidebar';
import { SignOutButton } from '@/client/components/sign-out-button';
import { signOut } from '@/server/auth/config';
import { requireSessionUser } from '@/server/auth/session';
import { loadWorkspace } from '@/server/db/workspace';

/** Everything together, above the accounts. */
const TOP: NavLink[] = [{ href: '/overview', label: 'Overview', icon: 'SquaresFour' }];

/** Below them: the things that are about the data rather than one account. */
const BOTTOM: NavLink[] = [
  { href: '/library', label: 'Statements', icon: 'Files' },
  { href: '/settings', label: 'Settings', icon: 'Gear' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every screen under (app) is behind this. Route handlers guard again at the
  // data layer, so a missed check here is never the only thing standing between
  // a request and someone else's statements.
  const user = await requireSessionUser();

  // The sidebar lists the user's actual accounts, so it is data, not config.
  const workspace = await loadWorkspace(user.userId);
  const latestPeriod = workspace.periods[workspace.periods.length - 1];

  async function endSession() {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return (
    <div className="app-frame">
      <Sidebar top={TOP} accounts={workspace.accounts} bottom={BOTTOM} period={latestPeriod} />
      <div className="app-main-col">
        {children}
        <footer className="app-footer">
          <span>Signed in as {user.email || user.name || 'demo user'}</span>
          <form action={endSession}>
            <SignOutButton />
          </form>
        </footer>
      </div>
    </div>
  );
}
