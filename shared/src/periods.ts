import type { IsoDate, Period } from './entities/common.js';

/**
 * Month arithmetic on `YYYY-MM` strings. Always UTC, never the local clock, so
 * the server and the browser agree on which month a date belongs to.
 */

export const MONTH_LABELS = [
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

export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

export function isYear(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}$/.test(value);
}

export function periodOf(date: IsoDate): Period {
  return date.slice(0, 7);
}

/**
 * A statement belongs to the month its period *ends* in. The Axis cycle runs
 * 17 May – 15 Jun, and a person thinks of that as their June bill.
 */
export function periodForStatement(periodEnd: IsoDate): Period {
  return periodOf(periodEnd);
}

/** The month containing today, in UTC. */
export function currentPeriod(): Period {
  return new Date().toISOString().slice(0, 7);
}

/** Inclusive list of `YYYY-MM` from one period to another. */
export function periodRange(from: Period, to: Period): Period[] {
  const out: Period[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (out.length > 240) break;
  }
  return out;
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

/** The Indian financial year a period falls in: Apr–Mar. */
export function financialYearOf(period: Period): { start: Period; end: Period; label: string } {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return {
    start: `${startYear}-04`,
    end: `${startYear + 1}-03`,
    label: `FY ${startYear}–${String(startYear + 1).slice(2)}`,
  };
}
