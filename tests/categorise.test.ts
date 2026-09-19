import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixtureInput } from './fixtures';
import { runDeterministicParser } from '@/server/parsing/registry';
import { applyLlmCategories, categoriseLocally, merchantLabel } from '@/server/domain/categorise';
import { categoryForIssuerCategory, categoryForMerchantRule } from '@/server/domain/merchant-rules';
import type { Category } from '@/shared/categories';
import type { ParsedTransaction } from '@/server/domain/schemas';

const NO_RULES = { userRules: new Map<string, Category>() };

function txn(fields: Partial<ParsedTransaction>): ParsedTransaction {
  return {
    date: '2026-06-01',
    descriptionRaw: '',
    counterparty: '',
    merchant: '',
    issuerCategory: null,
    amountMinor: 10000,
    direction: 'debit',
    mode: 'other',
    referenceNo: null,
    balanceAfterMinor: null,
    cashbackMinor: null,
    isFee: false,
    isInterest: false,
    isPayment: false,
    ...fields,
  };
}

describe('issuer category mapping', () => {
  it('maps the columns the Axis statement actually prints', () => {
    expect(categoryForIssuerCategory('CLOTH STORES')).toBe('Clothing');
    expect(categoryForIssuerCategory('RESTAURANTS')).toBe('Food & dining');
    expect(categoryForIssuerCategory('ELECTRONICS')).toBe('Electronics');
    expect(categoryForIssuerCategory('EDUCATION')).toBe('Education');
    expect(categoryForIssuerCategory('LEATHER GOODS')).toBe('Shopping');
    expect(categoryForIssuerCategory('MISC STORE')).toBe('Shopping');
    expect(categoryForIssuerCategory('RETAIL STORES')).toBe('Shopping');
  });

  it('returns null for a column it has never seen, rather than guessing', () => {
    expect(categoryForIssuerCategory('QUARRYING AND MINING')).toBeNull();
    expect(categoryForIssuerCategory(null)).toBeNull();
  });
});

describe('built-in merchant rules', () => {
  it('places the merchants the build spec calls out', () => {
    expect(categoryForMerchantRule('UPI/GOOGLE PLAY/…')).toBe('Digital & subscriptions');
    expect(categoryForMerchantRule('UDEMY AUTOPAY')).toBe('Education');
    // Axis prints this one letter-spaced as "U D E M Y", which no name rule can
    // reasonably match — and does not need to, because the issuer's own column
    // says EDUCATION on that row. A rule returning null here is correct.
    expect(categoryForMerchantRule('UPI/U D E M Y/…')).toBeNull();
    expect(categoryForMerchantRule('SWIGGY INSTAMART')).toBe('Groceries');
    expect(categoryForMerchantRule('ZOMATO ORDER')).toBe('Food & dining');
  });

  it('separates investing from moving money around', () => {
    // Buying into a broker is not the same as shuffling cash between your own
    // accounts, even though both are "money that left without being spent".
    expect(categoryForMerchantRule('UPI/STABLE BROKING PRIVA/x')).toBe('Investments');
    expect(categoryForMerchantRule('ZERODHA BROKING')).toBe('Investments');
    expect(categoryForMerchantRule('GROWW MUTUAL FUND SIP')).toBe('Investments');
    expect(categoryForMerchantRule('NPS CONTRIBUTION')).toBe('Investments');

    // The specific rule wins even when a transfer word is in the same row.
    expect(categoryForMerchantRule('NEFT TO ZERODHA SECURITIES')).toBe('Investments');

    // And a plain self-transfer stays where it was.
    expect(categoryForMerchantRule('UPI-Debit-123-SELF-x')).toBe('Cash & transfers');
    expect(categoryForMerchantRule('ATM CASH WITHDRAWAL')).toBe('Cash & transfers');
  });

  it('places fees and interest', () => {
    expect(categoryForMerchantRule('DCC MARKUP')).toBe('Fees & interest');
    expect(categoryForMerchantRule('GST')).toBe('Fees & interest');
  });
});

describe('categoriseLocally', () => {
  it('follows issuer, then rules, then Uncategorised', () => {
    const rows = [
      txn({ merchant: 'Sri Chakra Tex', issuerCategory: 'CLOTH STORES' }),
      txn({ merchant: 'Swiggy', descriptionRaw: 'UPI/SWIGGY/x' }),
      txn({ merchant: 'Kfjdl Traders', descriptionRaw: 'UPI/KFJDL TRADERS/x' }),
    ];
    const { categories, unresolvedMerchants } = categoriseLocally(rows, NO_RULES);
    expect(categories.map((c) => c.category)).toEqual([
      'Clothing',
      'Food & dining',
      'Uncategorised',
    ]);
    expect(categories.map((c) => c.source)).toEqual(['issuer', 'rule', 'rule']);
    expect(unresolvedMerchants).toEqual(['Kfjdl Traders']);
  });

  it('lets a user rule override the issuer', () => {
    const rows = [txn({ merchant: 'Sri Chakra Tex', issuerCategory: 'CLOTH STORES' })];
    const userRules = new Map<string, Category>([['sri chakra tex', 'Shopping']]);
    const { categories } = categoriseLocally(rows, { userRules });
    expect(categories[0]).toEqual({ category: 'Shopping', source: 'user' });
  });

  it('treats a savings interest credit as income and a card fee as fees', () => {
    const rows = [
      txn({ merchant: 'Interest credited', isInterest: true, direction: 'credit' }),
      txn({ merchant: 'Gst', isFee: true }),
      txn({ merchant: 'Payment received', isPayment: true, direction: 'credit' }),
    ];
    const { categories } = categoriseLocally(rows, NO_RULES);
    expect(categories.map((c) => c.category)).toEqual([
      'Income',
      'Fees & interest',
      'Cash & transfers',
    ]);
  });
});

describe('applyLlmCategories', () => {
  it('only fills in rows still Uncategorised', () => {
    const rows = [
      txn({ merchant: 'Sri Chakra Tex', issuerCategory: 'CLOTH STORES' }),
      txn({ merchant: 'Kfjdl Traders' }),
    ];
    const { categories } = categoriseLocally(rows, NO_RULES);
    const filled = applyLlmCategories(rows, categories, [
      // The model tries to overrule the issuer here; it must not win.
      { merchant: 'Sri Chakra Tex', category: 'Travel' },
      { merchant: 'Kfjdl Traders', category: 'Groceries' },
    ]);
    expect(filled[0]).toEqual({ category: 'Clothing', source: 'issuer' });
    expect(filled[1]).toEqual({ category: 'Groceries', source: 'llm' });
  });

  it('leaves everything alone when the model returned nothing', () => {
    const rows = [txn({ merchant: 'Kfjdl Traders' })];
    const { categories } = categoriseLocally(rows, NO_RULES);
    expect(applyLlmCategories(rows, categories, [])).toBe(categories);
  });
});

describe('against the real statements', () => {
  it('categorises the whole Axis cycle from the issuer column and the rules', () => {
    const statement = runDeterministicParser(fixtureInput(FIXTURE_NAMES.card))?.output?.statement;
    expect(statement).toBeDefined();
    if (!statement) return;

    const { categories, unresolvedMerchants } = categoriseLocally(statement.transactions, NO_RULES);
    const bySource = categories.reduce<Record<string, number>>((counts, category) => {
      counts[category.source] = (counts[category.source] ?? 0) + 1;
      return counts;
    }, {});
    expect(bySource.issuer).toBe(11);
    // Fees, the payment and the cashback credit come from the structural flags.
    expect(bySource.rule).toBe(4);
    expect(unresolvedMerchants).toEqual([]);
  });

  it('leaves slice transfers in Cash & transfers rather than inventing a merchant', () => {
    const statement = runDeterministicParser(fixtureInput(FIXTURE_NAMES.sliceAug))?.output
      ?.statement;
    expect(statement).toBeDefined();
    if (!statement) return;

    const { categories } = categoriseLocally(statement.transactions, NO_RULES);
    const self = statement.transactions
      .map((transaction, index) => ({ transaction, category: categories[index] }))
      .filter((row) => row.transaction.counterparty === 'Self');
    expect(self.length).toBeGreaterThan(0);
    expect(self.every((row) => row.category?.category === 'Cash & transfers')).toBe(true);
  });

  it('names a merchant for every row, so a user rule always has a key', () => {
    for (const name of Object.values(FIXTURE_NAMES)) {
      const statement = runDeterministicParser(fixtureInput(name))?.output?.statement;
      if (!statement) continue;
      for (const transaction of statement.transactions) {
        expect(merchantLabel(transaction).length).toBeGreaterThan(0);
      }
    }
  });
});
