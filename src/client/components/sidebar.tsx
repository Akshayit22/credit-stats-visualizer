'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { Icon } from './icon';
import * as nav from '@/client/lib/sidebar-store';

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof Icon;
  /** Also highlight the link for these path prefixes. */
  match?: string[];
  /** And for paths ending this way — cashback hangs off an account's path. */
  matchSuffix?: string;
  /**
   * Never highlight for these suffixes. `/accounts/x/cashback` is under the
   * card's prefix but belongs to Cashback, and two lit links is worse than
   * none.
   */
  exclude?: string[];
}

function isActive(item: NavItem, pathname: string): boolean {
  if ((item.exclude ?? []).some((suffix) => pathname.endsWith(suffix))) return false;
  if (pathname === item.href) return true;
  if ((item.match ?? []).some((prefix) => pathname.startsWith(prefix))) return true;
  return item.matchSuffix !== undefined && pathname.endsWith(item.matchSuffix);
}

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const open = useSyncExternalStore(nav.subscribe, nav.getSnapshot, nav.getServerSnapshot);
  const ToggleIcon = open ? Icon.ArrowLineLeft : Icon.ArrowLineRight;

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
        {items.map((item) => {
          const IconComponent = Icon[item.icon];
          const active = isActive(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="sidebar-link"
              aria-current={active ? 'page' : undefined}
              title={item.label}
            >
              <IconComponent size={16} aria-hidden="true" />
              {open ? (
                <span>{item.label}</span>
              ) : (
                <span className="visually-hidden">{item.label}</span>
              )}
            </Link>
          );
        })}
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
