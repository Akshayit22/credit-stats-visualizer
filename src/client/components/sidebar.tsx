'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import type { Account } from '@/shared/types';
import { Icon } from './icon';
import { accountShortName } from '@/client/lib/format';
import * as nav from '@/client/lib/sidebar-store';

/**
 * The sidebar is account-first, because that is the question a person actually
 * asks: *which* account, and *then* which view of it.
 *
 *   Overview                     ← everything together
 *
 *   ACCOUNTS
 *   ⌐ Axis Bank ··9581           ← the account
 *       Statement                ← its views, nested
 *       Cashback
 *   ⌐ slice savings ··6993
 *       Statement
 *
 *   Statements                   ← the library, all uploads
 *   Settings
 *
 * The previous flat list mixed the two — "Credit card", "Cashback" and
 * "Savings" sat at the same level, so with two cards you could not tell whose
 * cashback you were looking at, and Cashback had nowhere to belong.
 */

export interface NavLink {
  href: string;
  label: string;
  icon: keyof typeof Icon;
}

export interface SidebarProps {
  top: NavLink[];
  accounts: Account[];
  bottom: NavLink[];
  /** The month to carry into an account link, so switching keeps the period. */
  period?: string;
}

export function Sidebar({ top, accounts, bottom, period }: SidebarProps) {
  const pathname = usePathname();
  const open = useSyncExternalStore(nav.subscribe, nav.getSnapshot, nav.getServerSnapshot);
  const ToggleIcon = open ? Icon.ArrowLineLeft : Icon.ArrowLineRight;
  const query = period ? `?period=${period}` : '';

  return (
    <aside className="sidebar" data-collapsed={!open}>
      <Link href="/overview" className="sidebar-brand">
        <span className="sidebar-mark" aria-hidden="true" />
        {open ? (
          <span className="sidebar-brand-name">Statements</span>
        ) : (
          <span className="visually-hidden">cred-stats</span>
        )}
      </Link>

      <nav className="sidebar-nav" aria-label="Sections">
        {top.map((item) => (
          <SidebarLink key={item.href} item={item} active={pathname === item.href} open={open} />
        ))}

        {accounts.length > 0 && (
          <>
            {open && <p className="sidebar-heading">Accounts</p>}
            {!open && <span className="sidebar-rule" aria-hidden="true" />}
            {accounts.map((account) => (
              <AccountGroup
                key={account.accountId}
                account={account}
                pathname={pathname}
                open={open}
                query={query}
              />
            ))}
          </>
        )}

        {open && <p className="sidebar-heading">Everything</p>}
        {!open && <span className="sidebar-rule" aria-hidden="true" />}
        {bottom.map((item) => (
          <SidebarLink key={item.href} item={item} active={pathname === item.href} open={open} />
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => nav.setOpen(!open)}
        aria-expanded={open}
      >
        <ToggleIcon size={15} aria-hidden="true" />
        {open ? <span>Collapse</span> : <span className="visually-hidden">Expand sidebar</span>}
      </button>
    </aside>
  );
}

function SidebarLink({
  item,
  active,
  open,
}: {
  item: NavLink;
  active: boolean;
  open: boolean;
}) {
  const IconComponent = Icon[item.icon];
  return (
    <Link
      href={item.href}
      className="sidebar-link"
      aria-current={active ? 'page' : undefined}
      title={item.label}
    >
      <IconComponent size={16} aria-hidden="true" />
      {open ? <span>{item.label}</span> : <span className="visually-hidden">{item.label}</span>}
    </Link>
  );
}

/**
 * One account and the views that belong to it. A savings account has no
 * cashback screen — it earns interest, which the statement view already shows —
 * so it simply has one child rather than a disabled second one.
 */
function AccountGroup({
  account,
  pathname,
  open,
  query,
}: {
  account: Account;
  pathname: string;
  open: boolean;
  query: string;
}) {
  const isSavings = account.type === 'savings';
  const base = isSavings ? `/savings/${account.accountId}` : `/accounts/${account.accountId}`;
  const inThisAccount = pathname.startsWith(base);
  const onCashback = pathname.startsWith(`${base}/cashback`);

  const views = isSavings
    ? [{ href: base, label: 'Statement', active: inThisAccount }]
    : [
        { href: base, label: 'Statement', active: inThisAccount && !onCashback },
        { href: `${base}/cashback`, label: 'Cashback', active: onCashback },
      ];

  return (
    <div className="sidebar-group" data-open={inThisAccount}>
      <Link
        href={`${base}${query}`}
        className="sidebar-account"
        aria-current={inThisAccount ? 'true' : undefined}
        title={`${account.displayName} ${account.maskedNumber}`}
      >
        {isSavings ? (
          <Icon.Bank size={16} aria-hidden="true" />
        ) : (
          <Icon.CreditCard size={16} aria-hidden="true" />
        )}
        {open ? (
          <span className="sidebar-account-text">
            <span className="sidebar-account-name">{accountShortName(account)}</span>
            <span className="sidebar-account-sub">{account.maskedNumber}</span>
          </span>
        ) : (
          <span className="visually-hidden">{account.displayName}</span>
        )}
      </Link>

      {/* Collapsed, there is no room for children — the account icon is the
          whole control, and it goes to the statement view. */}
      {open && (
        <div className="sidebar-views">
          {views.map((view) => (
            <Link
              key={view.href}
              href={`${view.href}${query}`}
              className="sidebar-view"
              aria-current={view.active ? 'page' : undefined}
            >
              {view.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
