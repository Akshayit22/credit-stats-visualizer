import type { IsoDate, Period } from './entities/common.js';
import type { AccountType } from './entities/account.js';
import { MONTH_LABELS } from './periods.js';

/**
 * Display formatting for dates, periods and account names. Money has its own
 * module (`money.ts`); nothing here does arithmetic.
 */

function monthLabel(monthNumber: string): string {
  return MONTH_LABELS[Number(monthNumber) - 1] ?? monthNumber;
}

/** `2026-07` → `Jul 2026`. */
export function formatPeriodLabel(period: Period): string {
  return `${monthLabel(period.slice(5, 7))} ${period.slice(0, 4)}`;
}

/** `2026-07` → `Jul ’26`, for chips and axes. */
export function formatPeriodShort(period: Period): string {
  return `${monthLabel(period.slice(5, 7))} ’${period.slice(2, 4)}`;
}

/** `2026-07-04` → `04 Jul`. */
export function formatDayLabel(date: IsoDate): string {
  return `${date.slice(8, 10)} ${monthLabel(date.slice(5, 7))}`.trim();
}

/** `2026-07-04` → `04/07`, for dense tables. */
export function formatDayShort(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** `2026-07-01` → `2026-07-31` as `01 – 31 Jul 2026`. */
export function formatPeriodRange(start: IsoDate, end: IsoDate): string {
  const endLabel = `${end.slice(8, 10)} ${monthLabel(end.slice(5, 7))} ${end.slice(0, 4)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${start.slice(8, 10)} – ${endLabel}`;
  }
  return `${start.slice(8, 10)} ${monthLabel(start.slice(5, 7))} – ${endLabel}`;
}

interface NamedAccount {
  type: AccountType;
  issuer: string;
  productName: string;
}

/**
 * The product on its own, for use beneath the issuer — "Magnus", "Savings".
 * The issuer is the line above it, so repeating the bank here would read
 * "Axis Bank / Axis Bank Magnus".
 */
export function accountProductLine(account: NamedAccount): string {
  if (account.type === 'savings') return 'Savings';
  const product = account.productName.replace(/credit card/i, '').trim();
  return product.length > 0 ? product : 'Credit card';
}

/**
 * The short form of an account's name — what the sidebar and the sticky header
 * show. `displayName` is the full "Axis Bank · Supermoney RuPay Credit Card",
 * which is right on a page heading and too long anywhere narrow.
 */
export function accountShortName(account: NamedAccount): string {
  if (account.type === 'savings') {
    return `${account.issuer.split(' ')[0] ?? account.issuer} savings`;
  }
  const product = account.productName.replace(/credit card/i, '').trim();
  return product.length > 0 ? product : account.issuer;
}
