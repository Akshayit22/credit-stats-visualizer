import { describe, expect, it } from 'vitest';
import {
  accountProductLine,
  accountShortName,
  formatDayLabel,
  formatDayShort,
  formatPeriodLabel,
  formatPeriodRange,
  formatPeriodShort,
} from '../src/format.js';

describe('date and period labels', () => {
  it('names a period', () => {
    expect(formatPeriodLabel('2026-07')).toBe('Jul 2026');
    expect(formatPeriodShort('2026-07')).toBe('Jul ’26');
  });

  it('names a day', () => {
    expect(formatDayLabel('2026-07-04')).toBe('04 Jul');
    expect(formatDayShort('2026-07-04')).toBe('04/07');
  });

  it('writes a range inside one month without repeating it', () => {
    expect(formatPeriodRange('2026-07-01', '2026-07-31')).toBe('01 – 31 Jul 2026');
  });

  it('writes a card cycle that straddles two months', () => {
    expect(formatPeriodRange('2026-05-17', '2026-06-15')).toBe('17 May – 15 Jun 2026');
  });
});

describe('account names', () => {
  const card = {
    type: 'credit_card' as const,
    issuer: 'Axis Bank',
    productName: 'Supermoney RuPay Credit Card',
  };
  const savings = { type: 'savings' as const, issuer: 'slice small finance bank', productName: '' };

  it('shortens a card to its product', () => {
    expect(accountShortName(card)).toBe('Supermoney RuPay');
    expect(accountProductLine(card)).toBe('Supermoney RuPay');
  });

  it('falls back to the issuer when the product is only "credit card"', () => {
    const plain = { ...card, productName: 'Credit Card' };
    expect(accountShortName(plain)).toBe('Axis Bank');
    expect(accountProductLine(plain)).toBe('Credit card');
  });

  it('names a savings account by its bank', () => {
    expect(accountShortName(savings)).toBe('slice savings');
    expect(accountProductLine(savings)).toBe('Savings');
  });
});
