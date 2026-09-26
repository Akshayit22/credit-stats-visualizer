import { describe, expect, it } from 'vitest';
import { mergeAccount } from '../../src/domain/accounts.js';
import {
  accountIdFor,
  periodOfStatementId,
  statementIdFor,
  txnIdFor,
} from '../../src/domain/identifiers.js';
import type { ParsedAccount } from '../../src/domain/schemas.js';
import { anAccount } from '../helpers/factories.js';

describe('derived ids', () => {
  it('names an account by issuer, type and last four', () => {
    expect(accountIdFor('Axis Bank', 'credit_card', '9581')).toBe('axis-bank-credit-card-9581');
    expect(accountIdFor('slice small finance bank', 'savings', '6993')).toBe(
      'slice-small-finance-bank-savings-6993',
    );
  });

  it('names a statement by account and month, and reads the month back', () => {
    const id = statementIdFor('axis-bank-credit-card-9581', '2026-06');
    expect(id).toBe('axis-bank-credit-card-9581_2026-06');
    expect(periodOfStatementId(id)).toBe('2026-06');
    expect(periodOfStatementId('not-a-statement')).toBeNull();
    expect(periodOfStatementId('card_june')).toBeNull();
  });

  it('pads a row id so ids sort in print order', () => {
    expect(txnIdFor(3)).toBe('0003');
  });
});

describe('mergeAccount', () => {
  const parsed: ParsedAccount = {
    type: 'credit_card',
    issuer: 'Axis Bank',
    productName: 'Supermoney RuPay Credit Card',
    last4: '9581',
    maskedNumber: 'XXXX9581',
    creditLimitMinor: 60_000_00,
    cashLimitMinor: null,
    openedAt: null,
  };

  it('creates the account from the first statement that mentions it', () => {
    const account = mergeAccount(null, parsed, '2026-06-20T00:00:00.000Z');
    expect(account.accountId).toBe('axis-bank-credit-card-9581');
    expect(account.displayName).toBe('Axis Bank · Supermoney RuPay Credit Card');
    expect(account.createdAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('keeps the name and creation date, refreshes the limit', () => {
    const existing = anAccount({ displayName: 'My Axis card', cashLimitMinor: 10_000_00 });
    const account = mergeAccount(existing, parsed, '2026-07-20T00:00:00.000Z');
    expect(account.displayName).toBe('My Axis card');
    expect(account.createdAt).toBe(existing.createdAt);
    expect(account.creditLimitMinor).toBe(60_000_00);
    // Not printed this month, so the known value stays.
    expect(account.cashLimitMinor).toBe(10_000_00);
  });
});
