import { Sidebar, type NavItem } from '@/client/components/sidebar';
import { SignOutButton } from '@/client/components/sign-out-button';
import { signOut } from '@/server/auth/config';
import { requireSessionUser } from '@/server/auth/session';

const NAV: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: 'SquaresFour' },
  { href: '/accounts', label: 'Credit card', icon: 'CreditCard', match: ['/accounts'] },
  { href: '/savings', label: 'Savings', icon: 'Bank', match: ['/savings'] },
  { href: '/library', label: 'Statements', icon: 'Files' },
  { href: '/settings', label: 'Settings', icon: 'Gear' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every screen under (app) is behind this. Route handlers guard again at the
  // data layer, so a missed check here is never the only thing standing between
  // a request and someone else's statements.
  const user = await requireSessionUser();

  async function endSession() {
    'use server';
    await signOut({ redirectTo: '/sign-in' });
  }

  return (
    <div className="app-frame">
      <Sidebar items={NAV} />
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
