import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixtureInput } from '../fixtures';
import { runDeterministicParser } from '@/server/parsing/registry';
import { reconcile } from '@/server/domain/reconcile';
import { parsedStatementSchema, type ParsedStatement } from '@/server/domain/schemas';

/**
 * Two fixtures on purpose. IDFC prints the same statement in two layouts, and
 * a parser that reads only the one it was written against is a parser that
 * breaks on next month's download.
 */
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
  it.each([FIXTURE_NAMES.idfcOct, FIXTURE_NAMES.idfcDec])(
    'recognises %s from IDFC markers',
    (name) => {
      const { detection } = fixtureInput(name);
      expect(detection.parserId).toBe('idfc-savings');
      expect(detection.accountType).toBe('savings');
      expect(detection.issuer).toBe('IDFC FIRST Bank');
    },
  );
});

describe('idfc-savings parser — October 2025', () => {
  it('reads the period from the page header', () => {
    const statement = parseSavings(FIXTURE_NAMES.idfcOct);
    expect(statement.periodStart).toBe('2025-10-01');
    expect(statement.periodEnd).toBe('2025-10-31');
  });

  it('reads the summary strip past the two counts sitting in it', () => {
    // `008` and `010` are tallies of withdrawals and deposits, printed between
    // the amounts. Reading the strip by column puts the whole thing one out.
    const { savings } = parseSavings(FIXTURE_NAMES.idfcOct);
    expect(savings).toMatchObject({
      openingBalanceMinor: 69_263_400,
      totalDebitsMinor: 79_373_200,
      interestEarnedMinor: 19_600,
      closingBalanceMinor: 16_974_700,
    });
  });

  it('takes the interest back out of the deposits total', () => {
    // IDFC has one Deposits column and the interest credit is a row inside it,
    // where slice gives interest a column of its own. Reconciliation adds
    // credits and interest, so leaving it in makes every statement short by
    // exactly the interest it earned.
    const { savings } = parseSavings(FIXTURE_NAMES.idfcOct);
    expect(savings.totalCreditsMinor + savings.interestEarnedMinor).toBe(27_084_500);
    expect(savings.totalCreditsMinor).toBe(27_064_900);
  });

  it('keeps only the last four digits of the account number', () => {
    const { account } = parseSavings(FIXTURE_NAMES.idfcOct);
    expect(account.last4).toBe('1741');
    expect(account.maskedNumber).toBe('XXXX1741');
    expect(account.openedAt).toBe('2025-08-04');
  });

  it('reads every row, and reconciles', () => {
    const statement = parseSavings(FIXTURE_NAMES.idfcOct);
    expect(statement.transactions).toHaveLength(18);
    expect(reconcile(statement).ok).toBe(true);
  });

  it('gets direction from the balance moving, not from a column', () => {
    // The withdrawals and deposits columns are separate and an empty one is
    // not printed, so by the time the parser sees a row the amount is just a
    // number. The first two rows are a payment and its reversal: same amount,
    // opposite directions, and nothing but the balance says which is which.
    const statement = parseSavings(FIXTURE_NAMES.idfcOct);
    const [first, second] = statement.transactions;
    expect(first).toMatchObject({ date: '2025-10-01', amountMinor: 10_000_000, direction: 'debit' });
    expect(second).toMatchObject({
      date: '2025-10-01',
      amountMinor: 10_000_000,
      direction: 'credit',
    });
  });

  it('marks the monthly interest credit', () => {
    const statement = parseSavings(FIXTURE_NAMES.idfcOct);
    const interest = statement.transactions.filter((txn) => txn.isInterest);
    expect(interest).toHaveLength(1);
    expect(interest[0]).toMatchObject({
      date: '2025-10-31',
      direction: 'credit',
      amountMinor: 19_600,
      mode: 'interest',
      merchant: 'Interest credited',
    });
  });

  it('attributes a five-line description to the row it belongs to', () => {
    // This is the case the centring rule exists for: two continuation lines
    // above the money row and two below, with the next transaction's own lines
    // immediately after. Get the split wrong and a payment is filed under the
    // wrong counterparty.
    const statement = parseSavings(FIXTURE_NAMES.idfcOct);
    const row = statement.transactions.find((txn) => txn.date === '2025-10-08');
    expect(row?.descriptionRaw).toBe('NEFT/SCBLH28100511952/SELF/[ifsc]//ACC/NEFT TRANSFER');
    expect(row?.amountMinor).toBe(676_500);
  });
});

describe('idfc-savings parser — December 2025, the other layout', () => {
  it('reads a statement that splits the date and time across three lines', () => {
    // Here the date sits on the line above the money row, the time on the line
    // below, and the description shares both. Cell position is useless; the
    // row carrying the running balance is the only fixed point.
    const statement = parseSavings(FIXTURE_NAMES.idfcDec);
    expect(statement.periodStart).toBe('2025-12-01');
    expect(statement.transactions).toHaveLength(19);
    expect(reconcile(statement).ok).toBe(true);
  });

  it('dates rows from the transaction date, not the time below it', () => {
    const statement = parseSavings(FIXTURE_NAMES.idfcDec);
    expect(statement.transactions[0]).toMatchObject({
      date: '2025-12-01',
      direction: 'debit',
      amountMinor: 500_000,
    });
  });

  it('pulls the counterparty out of the slash-separated description', () => {
    const statement = parseSavings(FIXTURE_NAMES.idfcDec);
    const merchants = statement.transactions.map((txn) => txn.merchant);
    expect(merchants).toContain('Zerodha');
    expect(merchants).toContain('SHOBHA D');
    expect(merchants).toContain('CASHWITHDRAWAL');
  });

  it('reads a card transaction as card, not as a transfer', () => {
    const statement = parseSavings(FIXTURE_NAMES.idfcDec);
    const pos = statement.transactions.find((txn) => txn.descriptionRaw.startsWith('POS-'));
    expect(pos?.mode).toBe('card');
  });
});

describe('what both statements must never contain', () => {
  it.each([FIXTURE_NAMES.idfcOct, FIXTURE_NAMES.idfcDec])(
    'carries no holder name in %s, once the descriptions are rebuilt',
    (name) => {
      // Rebuilding a description is exactly where the name came back: the bank
      // wraps `AKSHAY` across a line break and the halves are only adjacent
      // after the parser drops the dates printed between them.
      const statement = parseSavings(name);
      const descriptions = statement.transactions.map((txn) => txn.descriptionRaw).join(' ');
      expect(descriptions).not.toMatch(/AKSHAY|TELANG|LALUMAN/i);
      expect(statement.transactions.map((txn) => txn.merchant).join(' ')).not.toMatch(
        /AKSHAY|TELANG|LALUMAN/i,
      );
    },
  );

  it.each([FIXTURE_NAMES.idfcOct, FIXTURE_NAMES.idfcDec])(
    'produces a statement %s that validates against the schema',
    (name) => {
      expect(() => parsedStatementSchema.parse(parseSavings(name))).not.toThrow();
    },
  );

  it.each([FIXTURE_NAMES.idfcOct, FIXTURE_NAMES.idfcDec])(
    'agrees with its own running balance on every row of %s',
    (name) => {
      // The parser warns when a row moves the balance by anything other than
      // the amount it states. No warning across either month is a per-row
      // check of all 37 amounts and directions, not just the summary totals.
      const attempt = runDeterministicParser(fixtureInput(name));
      expect(attempt?.output?.warnings ?? []).toEqual([]);
    },
  );
});
