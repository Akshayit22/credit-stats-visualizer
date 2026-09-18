import type { IsoDate, Period } from '@/shared/types';

/**
 * The date shapes Indian statements print, all landing on ISO `YYYY-MM-DD`.
 *
 *   `04 Jul '26`     slice — two-digit year behind an apostrophe
 *   `25/05/2026`     Axis  — DD/MM/YYYY, never MM/DD
 *   `31-Jul-2026`    slice — inside "Interest Cr. for 31-Jul-2026"
 *   `02 Sep '26`     slice — "Generated on"
 */

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

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

function monthIndex(name: string): number | null {
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]);
  return index === -1 ? null : index;
}

/** Two-digit years on a statement are always this century. */
function fullYear(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return Number.NaN;
  return raw.length <= 2 ? 2000 + value : value;
}

function iso(year: number, monthIndex0: number, day: number): IsoDate | null {
  if (!Number.isFinite(year) || day < 1 || day > 31 || monthIndex0 < 0 || monthIndex0 > 11) {
    return null;
  }
  const date = new Date(Date.UTC(year, monthIndex0, day));
  if (date.getUTCMonth() !== monthIndex0 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** `04 Jul '26`, `4 Jul 26`, `04 Jul 2026`. */
export function parseSpacedDate(raw: string): IsoDate | null {
  const match = raw
    .trim()
    .match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s*'?\s*(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  if (day === undefined || month === undefined || year === undefined) return null;
  const index = monthIndex(month);
  if (index === null) return null;
  return iso(fullYear(year), index, Number(day));
}

/** `25/05/2026`, `25-05-2026`. Day first, always. */
export function parseSlashDate(raw: string): IsoDate | null {
  const match = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  if (day === undefined || month === undefined || year === undefined) return null;
  return iso(fullYear(year), Number(month) - 1, Number(day));
}

/** `31-Jul-2026`. */
export function parseDashMonthDate(raw: string): IsoDate | null {
  const match = raw.trim().match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  if (day === undefined || month === undefined || year === undefined) return null;
  const index = monthIndex(month);
  if (index === null) return null;
  return iso(fullYear(year), index, Number(day));
}

/** Tries every shape above. */
export function parseAnyDate(raw: string): IsoDate | null {
  return parseSpacedDate(raw) ?? parseSlashDate(raw) ?? parseDashMonthDate(raw);
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

export function formatPeriodLabel(period: Period): string {
  const monthIndex0 = Number(period.slice(5, 7)) - 1;
  const label = MONTH_LABELS[monthIndex0] ?? period.slice(5, 7);
  return `${label} ${period.slice(0, 4)}`;
}

export function formatDayLabel(date: IsoDate): string {
  const monthIndex0 = Number(date.slice(5, 7)) - 1;
  return `${date.slice(8, 10)} ${MONTH_LABELS[monthIndex0] ?? ''}`.trim();
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
  const date = new Date(Date.UTC(year, month, 1));
  return date.toISOString().slice(0, 7);
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
