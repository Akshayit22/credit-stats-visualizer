import type { IsoDate } from '@cred-stats/shared';

/**
 * Reading the date shapes banks print. Period arithmetic and display
 * formatting live in `@cred-stats/shared`.
 *
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
  const match = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s*'?\s*(\d{2}|\d{4})$/);
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
