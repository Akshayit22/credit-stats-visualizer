import type { Account } from '@cred-stats/shared';
import { accountIdFor } from './identifiers.js';
import type { ParsedAccount } from './schemas.js';

/**
 * The account a statement describes, merged with what is already stored.
 *
 * Created on the first statement that mentions it; afterwards only the figures
 * that legitimately move month to month are refreshed. A credit limit can be
 * raised; the display name is the user's to keep.
 */
export function mergeAccount(
  existing: Account | null,
  parsed: ParsedAccount,
  now: string,
): Account {
  return {
    accountId: accountIdFor(parsed.issuer, parsed.type, parsed.last4),
    type: parsed.type,
    issuer: parsed.issuer,
    productName: parsed.productName || existing?.productName || '',
    displayName:
      existing?.displayName ||
      [parsed.issuer, parsed.productName].filter(Boolean).join(' · ') ||
      parsed.issuer,
    last4: parsed.last4,
    maskedNumber: parsed.maskedNumber || existing?.maskedNumber || `XXXX${parsed.last4}`,
    creditLimitMinor: parsed.creditLimitMinor ?? existing?.creditLimitMinor ?? null,
    cashLimitMinor: parsed.cashLimitMinor ?? existing?.cashLimitMinor ?? null,
    openedAt: parsed.openedAt ?? existing?.openedAt ?? null,
    createdAt: existing?.createdAt ?? now,
  };
}
