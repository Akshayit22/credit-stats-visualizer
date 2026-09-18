import type { Period } from '@/shared/types';
import { addMonths, periodRange } from './dates';

/**
 * Which months a screen shows, and which one is selected — resolved from the
 * URL so a period is linkable and the back button works.
 *
 *   ?mode=month&period=2026-07   one month
 *   ?mode=year&year=2026         a calendar year
 *
 * The window always spans the months the account actually has, padded out to
 * twelve so a gap in the middle is visible as a gap rather than silently
 * skipped. That is what the coverage note counts.
 */
export interface PeriodWindow {
  mode: 'month' | 'year';
  /** Every month the switcher offers, oldest first. */
  periods: Period[];
  selected: Period;
  year: string;
}

const MAX_WINDOW = 12;

export function resolvePeriodWindow(
  periodsWithData: Period[],
  params: { period?: string; mode?: string; year?: string },
): PeriodWindow {
  const mode = params.mode === 'year' ? 'year' : 'month';

  const latest = periodsWithData[periodsWithData.length - 1] ?? currentPeriod();
  const earliest = periodsWithData[0] ?? latest;

  // Pad the window back to twelve months when there is less data than that, so
  // the year view has a full shape and missing months read as missing.
  const start =
    periodRange(earliest, latest).length >= MAX_WINDOW
      ? earliest
      : addMonths(latest, -(MAX_WINDOW - 1));
  const windowPeriods = periodRange(start, latest);

  if (mode === 'year') {
    const year = isYear(params.year) ? params.year : latest.slice(0, 4);
    const inYear = windowPeriods.filter((period) => period.startsWith(year));
    return {
      mode,
      periods: inYear.length > 0 ? inYear : windowPeriods,
      selected: `${year}-12`,
      year,
    };
  }

  const requested = isPeriod(params.period) ? params.period : null;
  const selected =
    requested && windowPeriods.includes(requested)
      ? requested
      : (latest ?? windowPeriods[windowPeriods.length - 1] ?? currentPeriod());

  return { mode, periods: windowPeriods, selected, year: selected.slice(0, 4) };
}

function isPeriod(value: string | undefined): value is Period {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

function isYear(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}$/.test(value);
}

function currentPeriod(): Period {
  return new Date().toISOString().slice(0, 7);
}
