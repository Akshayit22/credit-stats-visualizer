import { describe, expect, it } from 'vitest';
import {
  recategoriseSchema,
  statementSchema,
  statementUploadSchema,
  transactionSchema,
} from '../src/index.js';

const transaction = {
  txnId: '0003',
  accountId: 'axis-bank-credit-card-9581',
  statementId: 'axis-bank-credit-card-9581_2026-06',
  seq: 3,
  date: '2026-05-25',
  descriptionRaw: 'SWIGGY',
  counterparty: 'SWIGGY',
  merchant: 'Swiggy',
  issuerCategory: 'RESTAURANTS',
  category: 'Food & dining',
  categorySource: 'issuer',
  amountMinor: 40000,
  direction: 'debit',
  mode: 'card',
  referenceNo: null,
  balanceAfterMinor: null,
  cashbackMinor: 400,
  isFee: false,
  isInterest: false,
  isPayment: false,
  userEdited: false,
};

describe('entity schemas', () => {
  it('accept a well-formed transaction and strip storage-only fields', () => {
    const parsed = transactionSchema.parse({ ...transaction, _id: 'x', userId: 'u' });
    expect(parsed).toEqual(transaction);
    expect('userId' in parsed).toBe(false);
  });

  it('reject money that is not integer paise', () => {
    expect(transactionSchema.safeParse({ ...transaction, amountMinor: 400.5 }).success).toBe(false);
  });

  it('reject a category outside the taxonomy', () => {
    expect(transactionSchema.safeParse({ ...transaction, category: 'Snacks' }).success).toBe(false);
  });

  it('discriminate statements on accountType', () => {
    const result = statementSchema.safeParse({ accountType: 'savings', card: {} });
    expect(result.success).toBe(false);
  });
});

describe('request schemas', () => {
  it('require a sha256 content hash on upload', () => {
    const base = {
      text: 'x'.repeat(40),
      meta: { pageCount: 1, extractedAt: '2026-08-01T00:00:00.000Z' },
    };
    expect(statementUploadSchema.safeParse({ ...base, contentHash: 'abc' }).success).toBe(false);
    const ok = statementUploadSchema.parse({ ...base, contentHash: 'a'.repeat(64) });
    expect(ok.meta.fileName).toBe('');
  });

  it('write a merchant rule on recategorise unless told not to', () => {
    expect(recategoriseSchema.parse({ category: 'Groceries' }).applyToMerchant).toBe(true);
    expect(
      recategoriseSchema.parse({ category: 'Groceries', applyToMerchant: false }).applyToMerchant,
    ).toBe(false);
  });
});
