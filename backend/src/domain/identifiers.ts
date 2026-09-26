import type { AccountType, Period } from '@cred-stats/shared';

/**
 * Ids are derived, never generated, so that the same card, the same month and
 * the same printed row always land on the same document. That is what makes
 * re-uploading a statement a replacement rather than a duplicate.
 */

/**
 * `(issuer, type, last4)` → `axis-bank-credit-card-9581`. The same card
 * recognised in next month's statement lands on the same account without a
 * lookup, and the id is readable in a URL.
 */
export function accountIdFor(issuer: string, type: AccountType, last4: string): string {
  const slug = issuer
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${slug}-${type.replace('_', '-')}-${last4}`;
}

/** `axis-bank-credit-card-9581_2026-06`. */
export function statementIdFor(accountId: string, period: Period): string {
  return `${accountId}_${period}`;
}

/** The period a statement id names, or null if it is not a statement id. */
export function periodOfStatementId(statementId: string): Period | null {
  const separator = statementId.lastIndexOf('_');
  if (separator <= 0) return null;
  const period = statementId.slice(separator + 1);
  return /^\d{4}-\d{2}$/.test(period) ? period : null;
}

/** A row's position in its statement, zero-padded so ids sort in print order. */
export function txnIdFor(seq: number): string {
  return String(seq).padStart(4, '0');
}
