import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixtureInput } from '../fixtures';
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
  it.each([FIXTURE_NAMES.scbNov, FIXTURE_NAMES.scbSep])(
    'recognises %s from Standard Chartered markers',
    (name) => {
      const { detection } = fixtureInput(name);
      expect(detection.parserId).toBe('scb-savings');
      expect(detection.accountType).toBe('savings');
      expect(detection.issuer).toBe('Standard Chartered');
    },
  );
});

describe('scb-savings parser — November 2025', () => {
  it('takes the period from the statement date and the opening row', () => {
    // This statement never prints a range. The end is the statement date in
    // the header; the start is whatever day the BALANCE FORWARD row is dated.
    const statement = parseSavings(FIXTURE_NAMES.scbNov);
    expect(statement.periodStart).toBe('2025-11-01');
    expect(statement.periodEnd).toBe('2025-11-30');
  });

  it('reads the summary off the first and last rows of the table', () => {
    // There is no summary strip: BALANCE FORWARD opens the table with the
    // opening balance and a Total row closes it with everything else.
    const { savings } = parseSavings(FIXTURE_NAMES.scbNov);
    expect(savings).toMatchObject({
      openingBalanceMinor: 1_294,
      totalCreditsMinor: 9_964_163,
      totalDebitsMinor: 9_959_950,
      closingBalanceMinor: 5_507,
    });
  });

  it('keeps only the last four digits of the account number', () => {
    const { account } = parseSavings(FIXTURE_NAMES.scbNov);
    expect(account.last4).toBe('9944');
    expect(account.maskedNumber).toBe('XXXX9944');
  });

  it('reads every row, and reconciles', () => {
    const statement = parseSavings(FIXTURE_NAMES.scbNov);
    expect(statement.transactions).toHaveLength(10);
    expect(reconcile(statement).ok).toBe(true);
  });

  it('gets direction from the balance moving, not from a column', () => {
    // Deposits and withdrawals are separate columns and an empty one is never
    // printed, so the amount arrives in no fixed position with nothing saying
    // which way it went.
    const statement = parseSavings(FIXTURE_NAMES.scbNov);
    const [first, second] = statement.transactions;
    expect(first).toMatchObject({ direction: 'credit', amountMinor: 736_663 });
    expect(second).toMatchObject({ direction: 'debit', amountMinor: 737_000 });
  });

  it('names the payer behind a salary credit', () => {
    // The payer's name is wrapped over two lines and sits between two copies
    // of the transfer reference: `BT <ref> PRESIDIO SOLUTIONS PRIVATE /
    // LIMITED STANDARD CHARTE <ref> CONCUR 257`.
    const statement = parseSavings(FIXTURE_NAMES.scbNov);
    const credits = statement.transactions.filter((txn) => txn.direction === 'credit');
    expect(credits.length).toBeGreaterThan(0);
    for (const credit of credits) {
      expect(credit.merchant).toBe('PRESIDIO SOLUTIONS PRIVATE LIMITED');
    }
  });

  it('joins continuation lines with a space, unlike the other banks', () => {
    // These are separate fields broken at spaces, not one hard-wrapped string.
    // Running them together the way slice and IDFC require would give
    // `PRIVATELIMITED`.
    const statement = parseSavings(FIXTURE_NAMES.scbNov);
    const salary = statement.transactions.find((txn) => txn.direction === 'credit');
    expect(salary?.descriptionRaw).toContain('PRESIDIO SOLUTIONS PRIVATE LIMITED');
  });

  it('marks a charge as a fee', () => {
    const statement = parseSavings(FIXTURE_NAMES.scbNov);
    const igst = statement.transactions.find((txn) => txn.descriptionRaw.startsWith('IGST'));
    expect(igst).toMatchObject({ isFee: true, direction: 'debit', amountMinor: 450 });
  });
});

describe('scb-savings parser — September 2025, the quarter interest landed', () => {
  it('marks the interest credit and takes it out of the deposits total', () => {
    // Interest is a row inside the single Deposits total, and reconciliation
    // adds credits and interest together. Counted in both places the statement
    // is over by exactly the interest it earned.
    const statement = parseSavings(FIXTURE_NAMES.scbSep);
    const interest = statement.transactions.filter((txn) => txn.isInterest);
    expect(interest).toHaveLength(1);
    expect(interest[0]).toMatchObject({
      date: '2025-09-30',
      direction: 'credit',
      amountMinor: 164_300,
      mode: 'interest',
      merchant: 'Interest credited',
    });
    expect(statement.savings.interestEarnedMinor).toBe(164_300);
    expect(statement.savings.totalCreditsMinor).toBe(9_461_275);
    expect(reconcile(statement).ok).toBe(true);
  });

  it('reads a card purchase as a counterparty, not a reference', () => {
    const statement = parseSavings(FIXTURE_NAMES.scbSep);
    const merchants = statement.transactions.map((txn) => txn.merchant);
    expect(merchants).toContain('PURCHASE UDEMY SUBSCRIPTION');
  });

  it('drops the bank reference code from a counterparty', () => {
    // `SCBLN520250909` is a code glued to a date. No company is named like
    // one, and left in it makes every transfer look like a different payee.
    const statement = parseSavings(FIXTURE_NAMES.scbSep);
    for (const txn of statement.transactions) {
      expect(txn.merchant).not.toMatch(/SCBLN\d/);
      expect(txn.merchant).not.toMatch(/IN1BT/);
    }
  });
});

describe('what both statements must never contain', () => {
  it.each([FIXTURE_NAMES.scbNov, FIXTURE_NAMES.scbSep])(
    'carries no holder name or date of birth in %s',
    (name) => {
      // This bank prints a transfer alias as `AKSHAYLT15012003` — the name run
      // together with a date of birth. Masking the name half alone left the
      // date standing.
      const statement = parseSavings(name);
      const text = statement.transactions
        .map((txn) => `${txn.descriptionRaw} ${txn.merchant}`)
        .join(' ');
      expect(text).not.toMatch(/AKSHAY|TELANG|LALUMAN/i);
      expect(text).not.toContain('15012003');
    },
  );

  it.each([FIXTURE_NAMES.scbNov, FIXTURE_NAMES.scbSep])(
    'produces a statement %s that validates against the schema',
    (name) => {
      expect(() => parsedStatementSchema.parse(parseSavings(name))).not.toThrow();
    },
  );

  it.each([FIXTURE_NAMES.scbNov, FIXTURE_NAMES.scbSep])(
    'agrees with its own running balance on every row of %s',
    (name) => {
      const attempt = runDeterministicParser(fixtureInput(name));
      expect(attempt?.output?.warnings ?? []).toEqual([]);
    },
  );
});
