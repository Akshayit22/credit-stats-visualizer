import { describe, expect, it } from 'vitest';
import {
  addMonths,
  financialYearOf,
  isPeriod,
  isYear,
  lastMonths,
  periodForStatement,
  periodRange,
} from '../src/periods.js';

describe('period arithmetic', () => {
  it('adds and subtracts months across a year boundary', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-06', -11)).toBe('2025-07');
  });

  it('lists an inclusive range, oldest first', () => {
    expect(periodRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(periodRange('2026-03', '2026-03')).toEqual(['2026-03']);
    expect(periodRange('2026-04', '2026-03')).toEqual([]);
  });

  it('gives the last n months ending at a period', () => {
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('files a card cycle under the month it ends in', () => {
    // 17 May – 15 Jun is the June bill.
    expect(periodForStatement('2026-06-15')).toBe('2026-06');
  });

  it('knows the Indian financial year runs April to March', () => {
    expect(financialYearOf('2026-03')).toEqual({
      start: '2025-04',
      end: '2026-03',
      label: 'FY 2025–26',
    });
    expect(financialYearOf('2026-04').start).toBe('2026-04');
  });

  it('recognises well-formed periods and years only', () => {
    expect(isPeriod('2026-07')).toBe(true);
    expect(isPeriod('2026-7')).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
    expect(isYear('2026')).toBe(true);
    expect(isYear('26')).toBe(false);
  });
});
