import { describe, expect, it } from 'vitest';
import {
  formatMinor,
  formatMinorCompact,
  parseAmountToMinor,
  stripInvisible,
} from '../src/money.js';

describe('parseAmountToMinor', () => {
  it('reads Indian digit grouping with the rupee sign', () => {
    expect(parseAmountToMinor('₹2,30,150.08')).toBe(23015008);
    expect(parseAmountToMinor('₹3,17,691.27')).toBe(31769127);
    expect(parseAmountToMinor('19,392.38')).toBe(1939238);
  });

  it('treats a leading minus as a debit', () => {
    expect(parseAmountToMinor('-₹8,700.00')).toBe(-870000);
    expect(parseAmountToMinor('-₹10,782.19')).toBe(-1078219);
  });

  it('reads bracketed negatives and bare integers', () => {
    expect(parseAmountToMinor('(250.00)')).toBe(-25000);
    expect(parseAmountToMinor('69,000')).toBe(6900000);
  });

  it('is exact on values a float would round badly', () => {
    expect(parseAmountToMinor('1,048.09')).toBe(104809);
    expect(parseAmountToMinor('0.07')).toBe(7);
    expect(parseAmountToMinor('218.04')).toBe(21804);
  });

  it('returns null when there is no amount', () => {
    expect(parseAmountToMinor('')).toBeNull();
    expect(parseAmountToMinor('RESTAURANTS')).toBeNull();
  });
});

describe('stripInvisible', () => {
  it('removes the zero-width space the slice statement hides in idfcfirst', () => {
    expect(stripInvisible('idfcf​irst')).toBe('idfcfirst');
    expect(stripInvisible('soft­hyphen')).toBe('softhyphen');
    expect(stripInvisible('a b')).toBe('a b');
  });
});

describe('formatting', () => {
  it('formats paise as en-IN rupees', () => {
    expect(formatMinor(23015008)).toBe('₹2,30,150.08');
    expect(formatMinor(23015008, 0)).toBe('₹2,30,150');
  });

  it('compacts for chart axes', () => {
    expect(formatMinorCompact(23015008)).toBe('₹2.3L');
    expect(formatMinorCompact(2601000)).toBe('₹26k');
    expect(formatMinorCompact(84000)).toBe('₹840');
  });
});
