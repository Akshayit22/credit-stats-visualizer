import { Sidebar, type NavItem } from '@/client/components/sidebar';

const NAV: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: 'SquaresFour' },
  { href: '/accounts', label: 'Credit card', icon: 'CreditCard', match: ['/accounts'] },
  { href: '/savings', label: 'Savings', icon: 'Bank', match: ['/savings'] },
  { href: '/library', label: 'Statements', icon: 'Files' },
  { href: '/settings', label: 'Settings', icon: 'Gear' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-frame">
      <Sidebar items={NAV} />
      <div className="app-main-col">{children}</div>
    </div>
  );
}
