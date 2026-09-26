import { accountProductLine, type Account } from '@cred-stats/shared';
import { useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router';
import * as nav from '../utils/sidebar-store';
import { Icon } from './icon';

/**
 * The sidebar is account-first, because that is the question a person actually
 * asks: *which* account, and *then* which view of it.
 *
 *   ⌐ Statements                 ‹      ← brand, and the collapse control
 *
 *   Overview                            ← everything together
 *
 *   ACCOUNTS
 *   ⌐ Axis Bank                         ← the bank, so it can be told apart
 *       Magnus ··9581                   ← the card on it
 *       Statement                       ← its views, nested
 *       Cashback
 *   ⌐ slice
 *       Savings ··6993
 *       Statement
 *
 *   Statements                          ← the library, all uploads
 *   Settings
 *
 * The toggle sits in the header rather than at the foot of the column. At the
 * foot it was the last item after a list that grows with the number of
 * accounts, and the column is a fixed `100vh` with `overflow: hidden` — so
 * past three or four accounts the only control that expands the sidebar was
 * pushed off the bottom and clipped, leaving a collapsed sidebar with no way
 * back. The scrolling now belongs to the nav alone; the header and the toggle
 * never move.
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
  const { pathname } = useLocation();
  const open = useSyncExternalStore(nav.subscribe, nav.getSnapshot, nav.getServerSnapshot);
  const ToggleIcon = open ? Icon.CaretLeft : Icon.CaretRight;
  const query = period ? `?period=${period}` : '';

  return (
    <aside className="sidebar" data-collapsed={!open}>
      <div className="sidebar-head">
        <Link to="/overview" className="sidebar-brand">
          <span className="sidebar-mark" aria-hidden="true" />
          {open ? (
            <span className="sidebar-brand-name">Statements</span>
          ) : (
            <span className="visually-hidden">cred-stats</span>
          )}
        </Link>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => nav.setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
          title={open ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <ToggleIcon size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>

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
    </aside>
  );
}

function SidebarLink({ item, active, open }: { item: NavLink; active: boolean; open: boolean }) {
  const IconComponent = Icon[item.icon];
  return (
    <Link
      to={item.href}
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
 *
 * The bank is the heading and the product the second line, not the other way
 * round: two cards from the same issuer are told apart by the product, but a
 * product name alone ("Magnus", "Millennia") does not say whose it is.
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
        to={`${base}${query}`}
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
            <span className="sidebar-account-name">{account.issuer}</span>
            <span className="sidebar-account-sub">
              {accountProductLine(account)} {account.maskedNumber}
            </span>
          </span>
        ) : (
          <span className="visually-hidden">
            {account.issuer} {accountProductLine(account)}
          </span>
        )}
      </Link>

      {/* Collapsed, there is no room for children — the account icon is the
          whole control, and it goes to the statement view. */}
      {open && (
        <div className="sidebar-views">
          {views.map((view) => (
            <Link
              key={view.href}
              to={`${view.href}${query}`}
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
