import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixtureInput, fixtureText } from '../fixtures';
import { runDeterministicParser } from '@/server/parsing/registry';
import { checkCashback, reconcile } from '@/server/domain/reconcile';
import type { ParsedStatement } from '@/server/domain/schemas';
import { parsedStatementSchema } from '@/server/domain/schemas';

function parseCard(): ParsedStatement & { accountType: 'credit_card' } {
  const attempt = runDeterministicParser(fixtureInput(FIXTURE_NAMES.card));
  expect(attempt).not.toBeNull();
  expect(attempt?.error).toBeNull();
  const statement = attempt?.output?.statement;
  if (!statement || statement.accountType !== 'credit_card') {
    throw new Error('expected a credit card statement');
  }
  return statement;
}

describe('detection', () => {
  it('recognises the Axis super.money card statement', () => {
    const { detection } = fixtureInput(FIXTURE_NAMES.card);
    expect(detection.parserId).toBe('axis-supermoney-card');
    expect(detection.accountType).toBe('credit_card');
    expect(detection.issuer).toBe('Axis Bank');
  });
});

describe('axis-supermoney-card parser', () => {
  it('reads the statement period and due dates', () => {
    const statement = parseCard();
    expect(statement.periodStart).toBe('2026-05-17');
    expect(statement.periodEnd).toBe('2026-06-15');
    expect(statement.dueDate).toBe('2026-07-05');
    expect(statement.statementDate).toBe('2026-06-15');
  });

  it('reads the account with the last four digits only', () => {
    const statement = parseCard();
    expect(statement.account.last4).toBe('9581');
    expect(statement.account.maskedNumber).toBe('XXXX9581');
    expect(statement.account.creditLimitMinor).toBe(6_900_000);
    expect(statement.account.cashLimitMinor).toBe(690_000);
  });

  it('reads the summary equation exactly, in paise', () => {
    const { card } = parseCard();
    expect(card).toMatchObject({
      previousBalanceMinor: 580_840,
      paymentsMinor: 580_840,
      creditsMinor: 9_600,
      purchasesMinor: 1_927_034,
      cashAdvanceMinor: 0,
      otherDebitsMinor: 21_804,
      totalDueMinor: 1_939_238,
      minimumDueMinor: 60_200,
      availableCreditMinor: 4_960_762,
    });
  });

  it('stores cashback earned and cashback credited separately', () => {
    const { card } = parseCard();
    expect(card.cashbackEarnedMinor).toBe(26_700);
    expect(card.cashbackCreditedMinor).toBe(9_600);
    expect(card.cashbackEarnedMinor).not.toBe(card.cashbackCreditedMinor);
  });

  it('reads every transaction row and no more', () => {
    const statement = parseCard();
    expect(statement.transactions).toHaveLength(15);
  });

  it('takes direction from the Dr/Cr suffix, not a minus sign', () => {
    const statement = parseCard();
    const credits = statement.transactions.filter((txn) => txn.direction === 'credit');
    expect(credits.map((txn) => txn.amountMinor).sort((a, b) => a - b)).toEqual([
      9_600, 580_840,
    ]);
    expect(statement.transactions.every((txn) => txn.amountMinor > 0)).toBe(true);
  });

  it('classifies fees, payments and the cashback credit', () => {
    const statement = parseCard();
    const fees = statement.transactions.filter((txn) => txn.isFee);
    expect(fees.map((txn) => txn.amountMinor)).toEqual([18_478, 3_326]);
    expect(fees.every((txn) => txn.mode === 'fee')).toBe(true);

    const payments = statement.transactions.filter((txn) => txn.isPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0]?.amountMinor).toBe(580_840);
    expect(payments[0]?.direction).toBe('credit');

    const cashbackCredit = statement.transactions.find((txn) =>
      /cashback/i.test(txn.descriptionRaw),
    );
    expect(cashbackCredit?.direction).toBe('credit');
    expect(cashbackCredit?.mode).toBe('other');
  });

  it('keeps the issuer merchant category on merchant rows and nowhere else', () => {
    const statement = parseCard();
    const categories = statement.transactions
      .map((txn) => txn.issuerCategory)
      .filter((value): value is string => value !== null);
    expect(categories).toEqual([
      'CLOTH STORES',
      'RESTAURANTS',
      'RETAIL STORES',
      'RESTAURANTS',
      'RESTAURANTS',
      'EDUCATION',
      'MISC STORE',
      'ELECTRONICS',
      'CLOTH STORES',
      'CLOTH STORES',
      'LEATHER GOODS',
    ]);
    // Fees, the payment and the cashback credit print no category cell.
    expect(statement.transactions.filter((txn) => txn.issuerCategory === null)).toHaveLength(4);
  });

  it('reads per-row cashback only from a Cr suffix', () => {
    const statement = parseCard();
    const earned = statement.transactions
      .map((txn) => txn.cashbackMinor)
      .filter((value): value is number => value !== null && value > 0);
    expect(earned.reduce((total, value) => total + value, 0)).toBe(26_700);

    // The payment row prints `0.00 Dr` in the cashback column — that is not
    // cashback, and must not be read as any.
    const payment = statement.transactions.find((txn) => txn.isPayment);
    expect(payment?.cashbackMinor).toBeNull();
  });

  it('reconciles the equation and the row total', () => {
    const statement = parseCard();
    const result = reconcile(statement);
    expect(result.ok).toBe(true);
    expect(result.differenceMinor).toBe(0);
  });

  it('agrees with the statement on total cashback earned', () => {
    const statement = parseCard();
    expect(checkCashback(statement)).toMatchObject({ ok: true, rowsMinor: 26_700 });
  });

  it('validates against the domain schema', () => {
    expect(() => parsedStatementSchema.parse(parseCard())).not.toThrow();
  });
});

describe('page 2 — the schedule of charges', () => {
  it('is present in the fixture, so the exclusion is actually being tested', () => {
    const text = fixtureText(FIXTURE_NAMES.card);
    expect(text).toContain('@@PAGE 2');
    expect(text).toMatch(/Schedule of charges/i);
    expect(text).toMatch(/Minimum Amount Due Calculation/i);
    // The worked examples that would wreck the parse if they were ever read.
    expect(text).toContain('1396.22');
    expect(text).toContain('8813.65');
    expect(text).toContain('1953.65');
  });

  it('contributes no transactions', () => {
    const statement = parseCard();
    const amounts = statement.transactions.map((txn) => txn.amountMinor);
    for (const stray of [108_986, 13_972, 5_370, 11_178, 139_622, 881_365, 195_365, 3_699]) {
      expect(amounts).not.toContain(stray);
    }
  });

  it('leaves every row inside the statement period', () => {
    const statement = parseCard();
    for (const txn of statement.transactions) {
      expect(txn.date >= statement.periodStart).toBe(true);
      expect(txn.date <= statement.periodEnd).toBe(true);
    }
  });

  it('is reported as skipped rather than silently dropped', () => {
    const attempt = runDeterministicParser(fixtureInput(FIXTURE_NAMES.card));
    expect(attempt?.output?.warnings.map((warning) => warning.code)).toContain('pages_skipped');
  });
});
