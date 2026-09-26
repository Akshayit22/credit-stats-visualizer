import { describe, expect, it } from 'vitest';
import type { Account, Statement } from '../src/entities/index.js';
import { resolveSection } from '../src/sections.js';

function account(accountId: string, type: Account['type']): Account {
  return {
    accountId,
    type,
    issuer: 'Bank',
    productName: '',
    displayName: accountId,
    last4: '1234',
    maskedNumber: 'XXXX1234',
    creditLimitMinor: null,
    cashLimitMinor: null,
    openedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function statement(accountId: string, period: string): Statement {
  return { accountId, period } as Statement;
}

describe('resolveSection', () => {
  const card = account('axis-bank-credit-card-9581', 'credit_card');
  const savings = account('slice-savings-6993', 'savings');

  it('sends /accounts to the newest statement of the first card', () => {
    const target = resolveSection(
      {
        accounts: [card],
        statements: [statement(card.accountId, '2026-05'), statement(card.accountId, '2026-06')],
      },
      'credit_card',
    );
    expect(target).toEqual({
      kind: 'redirect',
      href: `/accounts/${card.accountId}?period=2026-06`,
    });
  });

  it('sends /cashback to the card’s cashback screen', () => {
    const target = resolveSection({ accounts: [card], statements: [] }, 'credit_card', 'cashback');
    expect(target).toEqual({ kind: 'redirect', href: `/accounts/${card.accountId}/cashback` });
  });

  it('sends /savings to the savings screen', () => {
    const target = resolveSection({ accounts: [card, savings], statements: [] }, 'savings');
    expect(target).toEqual({ kind: 'redirect', href: `/savings/${savings.accountId}` });
  });

  it('offers the other kind of account when this kind is missing', () => {
    expect(resolveSection({ accounts: [savings], statements: [] }, 'credit_card')).toEqual({
      kind: 'empty',
      otherHref: `/savings/${savings.accountId}`,
    });
    expect(resolveSection({ accounts: [], statements: [] }, 'savings')).toEqual({
      kind: 'empty',
      otherHref: null,
    });
  });
});
