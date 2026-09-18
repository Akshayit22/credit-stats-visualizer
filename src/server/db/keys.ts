import type { Period } from '@/shared/types';

/** Every key prefix the app uses, in one place. */
export const KEY = {
  user: (userId: string) => `USER#${userId}`,
  profile: () => 'PROFILE',
  rule: (normalisedMerchant: string) => `RULE#${normalisedMerchant}`,
  account: (accountId: string) => `ACCOUNT#${accountId}`,
  statement: (accountId: string, period: Period) => `ACCOUNT#${accountId}#PERIOD#${period}`,
  contentHash: (hash: string) => `CONTENTHASH#${hash}`,
  userStatus: (userId: string, status: string) => `USER#${userId}#STATUS#${status}`,
  txn: (date: string, accountId: string, txnId: string) => `TXN#${date}#${accountId}#${txnId}`,
  txnMonthPrefix: (period: Period) => `TXN#${period}`,
  statementRef: (statementId: string) => `STATEMENT#${statementId}`,
  summaryAll: (period: Period) => `ALL#${period}`,
  summaryAccount: (accountId: string, period: Period) => `ACCOUNT#${accountId}#${period}`,
  summaryAllYearPrefix: (year: string) => `ALL#${year}`,
  summaryAccountYearPrefix: (accountId: string, year: string) => `ACCOUNT#${accountId}#${year}`,
} as const;

export function periodOf(isoDate: string): Period {
  return isoDate.slice(0, 7);
}
