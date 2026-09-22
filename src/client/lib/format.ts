import type { Period } from '@/shared/types';

/**
 * Client-side formatting helpers. These mirror `src/server/domain/dates.ts`
 * but live here so a client component never imports from `src/server`.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatPeriodLabel(period: Period): string {
  const index = Number(period.slice(5, 7)) - 1;
  return `${MONTHS[index] ?? period.slice(5, 7)} ${period.slice(0, 4)}`;
}

export function formatPeriodShort(period: Period): string {
  const index = Number(period.slice(5, 7)) - 1;
  return `${MONTHS[index] ?? period.slice(5, 7)} ’${period.slice(2, 4)}`;
}

/** `2026-07-04` → `04 Jul`. */
export function formatDayLabel(date: string): string {
  const index = Number(date.slice(5, 7)) - 1;
  return `${date.slice(8, 10)} ${MONTHS[index] ?? ''}`.trim();
}

/** `2026-07-04` → `04/07`, for dense tables. */
export function formatDayShort(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** `2026-07-01` → `2026-07-31` as `01 – 31 Jul 2026`. */
export function formatPeriodRange(start: string, end: string): string {
  const startMonth = Number(start.slice(5, 7)) - 1;
  const endMonth = Number(end.slice(5, 7)) - 1;
  const endLabel = `${end.slice(8, 10)} ${MONTHS[endMonth] ?? ''} ${end.slice(0, 4)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${start.slice(8, 10)} – ${endLabel}`;
  }
  return `${start.slice(8, 10)} ${MONTHS[startMonth] ?? ''} – ${endLabel}`;
}

export function addMonths(period: Period, delta: number): Period {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7)) - 1 + delta;
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

/** The last `count` months ending at `end`, oldest first. */
export function lastMonths(end: Period, count: number): Period[] {
  return Array.from({ length: count }, (_, index) => addMonths(end, index - count + 1));
}

/**
 * The short form of an account's name — what the sidebar and the sticky header
 * show. `displayName` is the full "Axis Bank · Supermoney RuPay Credit Card",
 * which is right on a page heading and too long anywhere narrow.
 */
/**
 * The product on its own, for use beneath the issuer — "Magnus", "Savings".
 * The issuer is the line above it, so repeating the bank here would read
 * "Axis Bank / Axis Bank Magnus".
 */
export function accountProductLine(account: {
  type: 'credit_card' | 'savings';
  issuer: string;
  productName: string;
}): string {
  if (account.type === 'savings') return 'Savings';
  const product = account.productName.replace(/credit card/i, '').trim();
  return product.length > 0 ? product : 'Credit card';
}

export function accountShortName(account: {
  type: 'credit_card' | 'savings';
  issuer: string;
  productName: string;
}): string {
  if (account.type === 'savings') {
    return `${account.issuer.split(' ')[0] ?? account.issuer} savings`;
  }
  const product = account.productName.replace(/credit card/i, '').trim();
  return product.length > 0 ? product : account.issuer;
}
