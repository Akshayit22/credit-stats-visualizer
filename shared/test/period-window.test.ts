import { describe, expect, it } from 'vitest';
import { resolvePeriodWindow } from '../src/period-window.js';

describe('resolvePeriodWindow', () => {
  const withData = ['2026-06', '2026-07', '2026-08'];

  it('selects the newest month with data by default', () => {
    const window = resolvePeriodWindow(withData, {});
    expect(window.mode).toBe('month');
    expect(window.selected).toBe('2026-08');
    expect(window.year).toBe('2026');
  });

  it('pads a short history back to twelve months so gaps read as gaps', () => {
    const window = resolvePeriodWindow(withData, {});
    expect(window.periods).toHaveLength(12);
    expect(window.periods[0]).toBe('2025-09');
    expect(window.periods.at(-1)).toBe('2026-08');
  });

  it('honours a requested month inside the window', () => {
    expect(resolvePeriodWindow(withData, { period: '2026-06' }).selected).toBe('2026-06');
  });

  it('ignores a requested month outside the window or malformed', () => {
    expect(resolvePeriodWindow(withData, { period: '2020-01' }).selected).toBe('2026-08');
    expect(resolvePeriodWindow(withData, { period: 'june' }).selected).toBe('2026-08');
  });

  it('shows one calendar year in year mode', () => {
    const window = resolvePeriodWindow(withData, { mode: 'year', year: '2026' });
    expect(window.mode).toBe('year');
    expect(window.year).toBe('2026');
    expect(window.periods.every((period) => period.startsWith('2026'))).toBe(true);
  });

  it('still answers with no data at all', () => {
    const window = resolvePeriodWindow([], {});
    expect(window.periods).toHaveLength(12);
    expect(window.selected).toBe(window.periods.at(-1));
  });
});
