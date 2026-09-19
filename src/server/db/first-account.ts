import { redirect } from 'next/navigation';
import type { AccountType } from '@/shared/types';
import { loadWorkspace, periodsForAccount } from './workspace';

/**
 * The sidebar links to `/accounts`, `/savings` and `/cashback` — a section,
 * not a particular account. Each of those is an index route that sends you to
 * the newest statement of the first account of that type, because "show me my
 * credit card" means the card you actually have, not a picker with one option.
 *
 * With no account of that type there is nothing to redirect to, so the caller
 * renders an empty state instead.
 */
export interface SectionTarget {
  kind: 'redirect';
  href: string;
}

export interface SectionEmpty {
  kind: 'empty';
  /** The other type, when the user has one of those but not this one. */
  otherHref: string | null;
}

export async function resolveSection(
  userId: string,
  type: AccountType,
  /** `cashback` hangs off a card account rather than being its own screen. */
  view: 'account' | 'cashback' = 'account',
): Promise<SectionTarget | SectionEmpty> {
  const workspace = await loadWorkspace(userId);
  const matching = workspace.accounts.filter((account) => account.type === type);

  const first = matching[0];
  if (!first) {
    const other = workspace.accounts[0];
    return {
      kind: 'empty',
      otherHref: other
        ? other.type === 'savings'
          ? `/savings/${other.accountId}`
          : `/accounts/${other.accountId}`
        : null,
    };
  }

  // Land on the newest month that actually has a statement, so the screen is
  // never an empty state when there is data one chip to the left.
  const periods = periodsForAccount(workspace, first.accountId);
  const newest = periods[periods.length - 1];
  const base =
    type === 'savings'
      ? `/savings/${first.accountId}`
      : view === 'cashback'
        ? `/accounts/${first.accountId}/cashback`
        : `/accounts/${first.accountId}`;

  return { kind: 'redirect', href: newest ? `${base}?period=${newest}` : base };
}

/** Redirects, or returns the empty-state details for the caller to render. */
export async function redirectToSection(
  userId: string,
  type: AccountType,
  view: 'account' | 'cashback' = 'account',
): Promise<SectionEmpty> {
  const target = await resolveSection(userId, type, view);
  if (target.kind === 'redirect') redirect(target.href);
  return target;
}
