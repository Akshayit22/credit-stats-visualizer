import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixtureInput, fixtureText } from '../fixtures';
import { runDeterministicParser } from '@/server/parsing/registry';
import { reconcile } from '@/server/domain/reconcile';
import { parsedStatementSchema, type ParsedStatement } from '@/server/domain/schemas';

function parseSavings(name: string): ParsedStatement & { accountType: 'savings' } {
  const attempt = runDeterministicParser(fixtureInput(name));
  expect(attempt?.error).toBeNull();
  const statement = attempt?.output?.statement;
  if (!statement || statement.accountType !== 'savings') {
    throw new Error('expected a savings statement');
  }
  return statement;
}

describe('detection', () => {
  it('recognises a slice savings statement from its own markers', () => {
    const { detection } = fixtureInput(FIXTURE_NAMES.sliceJul);
    expect(detection.parserId).toBe('slice-savings');
    expect(detection.accountType).toBe('savings');
    expect(detection.issuer).toBe('slice small finance bank');
  });
});

describe('slice-savings parser — July 2026', () => {
  it('reads the period from the page header', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceJul);
    expect(statement.periodStart).toBe('2026-07-01');
    expect(statement.periodEnd).toBe('2026-07-31');
  });

  it('reads the summary strip exactly, in paise', () => {
    const { savings } = parseSavings(FIXTURE_NAMES.sliceJul);
    expect(savings).toMatchObject({
      openingBalanceMinor: 23_015_008,
      totalCreditsMinor: 11_680_000,
      interestEarnedMinor: 86_074,
      totalDebitsMinor: 7_190_000,
      closingBalanceMinor: 27_591_082,
      generatedAt: '2026-08-02',
    });
  });

  it('keeps only the last four digits of the account number', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceJul);
    expect(statement.account.last4).toBe('6993');
    expect(statement.account.maskedNumber).toBe('XXXX6993');
    expect(statement.account.openedAt).toBe('2026-06-21');
  });

  it('takes direction from the leading minus, not a Dr/Cr suffix', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceJul);
    expect(statement.transactions.every((txn) => txn.amountMinor > 0)).toBe(true);

    const firstDebit = statement.transactions.find((txn) => txn.direction === 'debit');
    expect(firstDebit?.amountMinor).toBe(870_000);
    expect(firstDebit?.date).toBe('2026-07-04');
    expect(firstDebit?.mode).toBe('upi');
  });

  it('joins wrapped DETAILS lines with no separator', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceJul);
    // The note wraps as "Payment from slic" + "e" across two physical lines;
    // joining those with a space would give "slic e".
    const wrapped = statement.transactions.filter((txn) =>
      txn.descriptionRaw.includes('Payment from slice'),
    );
    expect(wrapped.length).toBeGreaterThan(0);
    for (const txn of wrapped) {
      // The zero-width space slice hides inside "idfcfirst" must be gone too.
      expect(txn.descriptionRaw).not.toContain('​');
      expect(txn.descriptionRaw).not.toMatch(/slic\s+e/);
    }

    // The counterparty name wraps mid-word as well: "…MRIDH" + "A-…".
    const aug = parseSavings(FIXTURE_NAMES.sliceAug);
    const mridha = aug.transactions.find((txn) => /MRIDHA/.test(txn.descriptionRaw));
    expect(mridha?.counterparty).toBe('Anup Kumar Mridha');
  });

  it('marks the daily interest credits so the UI can fold them away', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceJul);
    const interest = statement.transactions.filter((txn) => txn.isInterest);
    expect(interest.length).toBeGreaterThan(25);
    expect(interest.every((txn) => txn.direction === 'credit')).toBe(true);
    expect(interest.every((txn) => txn.mode === 'interest')).toBe(true);
    const total = interest.reduce((sum, txn) => sum + txn.amountMinor, 0);
    expect(total).toBe(86_074);
  });

  it('carries the running balance on every row', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceJul);
    expect(statement.transactions.every((txn) => txn.balanceAfterMinor !== null)).toBe(true);
    const last = statement.transactions[statement.transactions.length - 1];
    expect(last?.balanceAfterMinor).toBe(statement.savings.closingBalanceMinor);
  });

  it('reconciles the summary and chains every running balance', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceJul);
    const result = reconcile(statement);
    expect(result.message).toContain('reconciled');
    expect(result.ok).toBe(true);
  });

  it('validates against the domain schema', () => {
    expect(() => parsedStatementSchema.parse(parseSavings(FIXTURE_NAMES.sliceJul))).not.toThrow();
  });
});

describe('slice-savings parser — August 2026', () => {
  it('reads the second month the same way', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceAug);
    expect(statement.periodStart).toBe('2026-08-01');
    expect(statement.periodEnd).toBe('2026-08-31');
    expect(statement.savings).toMatchObject({
      openingBalanceMinor: 27_593_837,
      totalCreditsMinor: 10_203_100,
      interestEarnedMinor: 104_809,
      totalDebitsMinor: 6_132_619,
      closingBalanceMinor: 31_769_127,
      generatedAt: '2026-09-02',
    });
    expect(reconcile(statement).ok).toBe(true);
  });

  it('reads IMPS rows, including the reversal', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceAug);
    const imps = statement.transactions.filter((txn) =>
      txn.descriptionRaw.startsWith('IMPS-'),
    );
    expect(imps).toHaveLength(3);

    const reversal = imps.find((txn) => txn.descriptionRaw.startsWith('IMPS-Reversal'));
    expect(reversal?.direction).toBe('credit');
    expect(reversal?.amountMinor).toBe(1_000);

    const debit = imps.find((txn) => txn.descriptionRaw.startsWith('IMPS-Debit'));
    expect(debit?.direction).toBe('debit');
    expect(debit?.amountMinor).toBe(1_000);
  });

  it('names the counterparty from the UPI description', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceAug);
    const cheq = statement.transactions.find((txn) => /cheq/i.test(txn.descriptionRaw));
    expect(cheq?.counterparty).toBe('CheQ');
    expect(cheq?.direction).toBe('debit');
    expect(cheq?.amountMinor).toBe(573_300);

    const anup = statement.transactions.find((txn) => /ANUP KUMAR/i.test(txn.descriptionRaw));
    expect(anup?.counterparty).toBe('Anup Kumar Mridha');
  });

  it('calls the holder’s own transfers Self, because the name was redacted', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceAug);
    const own = statement.transactions.filter((txn) => txn.counterparty === 'Self');
    expect(own.length).toBeGreaterThan(5);
    // The largest August credit is a transfer from the holder's own account.
    const biggest = [...statement.transactions]
      .filter((txn) => txn.direction === 'credit' && !txn.isInterest)
      .sort((a, b) => b.amountMinor - a.amountMinor)[0];
    expect(biggest?.amountMinor).toBe(8_430_000);
    expect(biggest?.counterparty).toBe('Self');
  });
});

describe('both slice months', () => {
  it('keeps the transaction count the statement implies', () => {
    expect(parseSavings(FIXTURE_NAMES.sliceJul).transactions).toHaveLength(41);
    expect(parseSavings(FIXTURE_NAMES.sliceAug).transactions).toHaveLength(49);
  });

  it('never reads a page footer as a transaction', () => {
    const statement = parseSavings(FIXTURE_NAMES.sliceAug);
    for (const txn of statement.transactions) {
      expect(txn.descriptionRaw).not.toMatch(/Need help\?/i);
      expect(txn.descriptionRaw).not.toMatch(/slice small finance bank/i);
      expect(txn.descriptionRaw).not.toMatch(/Generated on/i);
    }
  });

  it('reads rows from every page, not just the first', () => {
    const text = fixtureText(FIXTURE_NAMES.sliceAug);
    expect(text).toContain('@@PAGE 3');
    const statement = parseSavings(FIXTURE_NAMES.sliceAug);
    // The last row is on page 3; finding it proves later pages were read.
    expect(statement.transactions[statement.transactions.length - 1]?.date).toBe('2026-08-31');
  });
});
