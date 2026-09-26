import { Navigate, Outlet } from 'react-router';
import { PageError, PageLoading } from '../components/page-state';
import { Sidebar, type NavLink } from '../components/sidebar';
import { SignOutButton } from '../components/sign-out-button';
import { useSession, useWorkspace } from '../hooks/queries';

/** Everything together, above the accounts. */
const TOP: NavLink[] = [{ href: '/overview', label: 'Overview', icon: 'SquaresFour' }];

/** Below them: the things that are about the data rather than one account. */
const BOTTOM: NavLink[] = [
  { href: '/library', label: 'Statements', icon: 'Files' },
  { href: '/settings', label: 'Settings', icon: 'Gear' },
];

/** Shown to the site's admins only; the API enforces it regardless. */
const ADMIN: NavLink = { href: '/admin', label: 'Admin', icon: 'ShieldCheck' };

/**
 * The frame around every signed-in screen: the sidebar, the page, the footer.
 *
 * No session means the sign-in page. This is a convenience, not the security
 * boundary — every API call checks the session again on the server.
 */
export function AppLayout() {
  const session = useSession();
  const workspace = useWorkspace({ enabled: session.isSuccess });

  if (session.isPending) return <PageLoading label="Checking your session" />;
  if (session.isError || !session.data) return <Navigate to="/sign-in" replace />;

  const accounts = workspace.data?.accounts ?? [];
  const latestPeriod = workspace.data?.periods.at(-1);
  const user = session.data;

  return (
    <div className="app-frame">
      <Sidebar
        top={TOP}
        accounts={accounts}
        bottom={user.isAdmin ? [...BOTTOM, ADMIN] : BOTTOM}
        period={latestPeriod}
      />
      <div className="app-main-col">
        {workspace.isError ? (
          <PageError error={workspace.error} onRetry={() => void workspace.refetch()} />
        ) : (
          <Outlet />
        )}
        <footer className="app-footer">
          <span>Signed in as {user.email || user.name || 'demo user'}</span>
          <SignOutButton />
        </footer>
      </div>
    </div>
  );
}
