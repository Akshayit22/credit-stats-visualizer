import type { Account, AccountType } from './entities/account.js';
import type { Statement } from './entities/statement.js';

/**
 * The sidebar links to `/accounts`, `/savings` and `/cashback` — a section, not
 * a particular account. Each of those sends you to the newest statement of the
 * first account of that type, because "show me my credit card" means the card
 * you actually have, not a picker with one option.
 *
 * With no account of that type there is nothing to go to, so the caller shows
 * an empty state — pointing at the other kind of account when there is one.
 */

export type SectionView = 'account' | 'cashback';

export type SectionTarget =
  | { kind: 'redirect'; href: string }
  | { kind: 'empty'; otherHref: string | null };

export function accountHref(account: Pick<Account, 'accountId' | 'type'>): string {
  return account.type === 'savings'
    ? `/savings/${account.accountId}`
    : `/accounts/${account.accountId}`;
}

export function resolveSection(
  workspace: { accounts: Account[]; statements: Statement[] },
  type: AccountType,
  view: SectionView = 'account',
): SectionTarget {
  const first = workspace.accounts.find((account) => account.type === type);

  if (!first) {
    const other = workspace.accounts[0];
    return { kind: 'empty', otherHref: other ? accountHref(other) : null };
  }

  // Land on the newest month that actually has a statement, so the screen is
  // never an empty state when there is data one chip to the left.
  const newest = periodsForAccount(workspace.statements, first.accountId).at(-1);
  const base =
    view === 'cashback' && type === 'credit_card'
      ? `/accounts/${first.accountId}/cashback`
      : accountHref(first);

  return { kind: 'redirect', href: newest ? `${base}?period=${newest}` : base };
}

/** The months an account has a statement for, oldest first. */
export function periodsForAccount(statements: Statement[], accountId: string): string[] {
  return [
    ...new Set(
      statements
        .filter((statement) => statement.accountId === accountId)
        .map((statement) => statement.period),
    ),
  ].sort();
}
