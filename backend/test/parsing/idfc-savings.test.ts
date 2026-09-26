import { describe, expect, it } from 'vitest';
import { parserInputFor, runDeterministicParser } from '../../src/parsing/registry.js';
import { reconcile } from '../../src/domain/reconcile.js';
import { parsedStatementSchema, type ParsedStatement } from '../../src/domain/schemas.js';

/**
 * These statements are invented, not redacted.
 *
 * The parser was written against seven real IDFC statements and is committed
 * with none of them: a redacted fixture is still a record of somebody's month,
 * and the repository has no reason to hold one. What the tests actually need is
 * the *layout* — and a layout can be written out by hand.
 *
 * So the figures below are made up, but arranged exactly as the bank arranges
 * them, including the two things that make this parser hard: a description
 * rendered as a block centred on the row carrying the money, and a second cell
 * layout the same bank uses for the same statement.
 */

/**
 * Layout A. The date and time share one cell on the money row, and each
 * description wraps one line above it and one line below.
 */
const CENTRED_LAYOUT = [
  '@@PAGE 1',
  'CONSOLIDATED STATEMENT',
  'CUSTOMER ID\t[customer-id]',
  'STATEMENT PERIOD\t: 01-OCT-2025 to 31-OCT-2025',
  'SELF',
  '[address]',
  'REGISTERED OFFICE: IDFC FIRST BANK LIMITED',
  'SUMMARY OF YOUR RELATIONSHIP WITH US AS OF 31-OCT-2025',
  'Account Type\tBalance\tAccount Type\tBalance',
  'Savings\tINR 1,200.00 CR\tLoans\tNA',
  'TRANSACTION ACCOUNTS',
  'SAVINGS ACCOUNT DETAILS FOR A/C : XXXX4321',
  'Opening Balance\tNumber of\tNumber of Deposits\tWithdrawals\tDeposits\tClosing Balance',
  '(INR)\tWithdrawals\t(INR)\t(INR)\t(INR)',
  '1,000.00 CR\t001\t002\t500.00\t700.00\t1,200.00 CR',
  'Date and Time\tValue Date\tTransaction Details\tRef/Cheque\tWithdrawals\tDeposits\tBalance',
  'No.\t(INR)\t(INR)\t(INR)',
  'Opening Balance\t1,000.00 CR',
  // One line above, one below — the ordinary case.
  'UPI/DR/900000000001/GROCER',
  '01 Oct 25 10:15\t01 Oct 25\tY MART/ICIC/grocery/pay\t500.00\t500.00 CR',
  '/UPI',
  'NEFT/REF900000000002/ACME',
  '02 Oct 25 11:00\t02 Oct 25\tTRADING CO\t600.00\t1,100.00 CR',
  '/[ifsc]',
  // The interest credit: no description cell on the money row at all.
  'MONTHLY SAVINGS',
  '31 Oct 25 02:43\t31 Oct 25\t100.00\t1,200.00 CR',
  'INTEREST CREDIT',
  'CUSTOMER NAME\tSELF\tACCOUNT BRANCH\tSOMEWHERE',
  'ACCOUNT OPENING DATE\t04-AUG-2025',
].join('\n');

/**
 * Layout B. The same bank, splitting that column: the date sits on the line
 * above the money row and the time on the line below, with the description
 * sharing both.
 */
const SPLIT_LAYOUT = [
  '@@PAGE 1',
  'CONSOLIDATED STATEMENT',
  'CUSTOMER ID\t[customer-id]',
  'STATEMENT PERIOD\t: 01-DEC-2025 to 31-DEC-2025',
  'SELF',
  'REGISTERED OFFICE: IDFC FIRST BANK LIMITED',
  'SUMMARY OF YOUR RELATIONSHIP WITH US AS OF 31-DEC-2025',
  'SAVINGS ACCOUNT DETAILS FOR A/C : XXXX4321',
  'Opening Balance\tNumber of\tNumber of Deposits\tWithdrawals\tDeposits\tClosing Balance',
  '(INR)\tWithdrawals\t(INR)\t(INR)\t(INR)',
  '2,000.00 CR\t001\t001\t800.00\t300.00\t1,500.00 CR',
  'Date and Time\tValue Date\tTransaction Details\tRef/Cheque\tWithdrawals\tDeposits\tBalance',
  'No.\t(INR)\t(INR)\t(INR)',
  'opening balance\t2,000.00 CR',
  '01 Dec 25\tUPI/DR/900000000003/BOOKS',
  '01 Dec 25\t800.00\t1,200.00 CR',
  '00:23\tHOP/ICIC/bookshop/pay',
  '05 Dec 25\tUPI/CR/900000000004/REFUND',
  '05 Dec 25\t300.00\t1,500.00 CR',
  '09:10\tCO/SBIN/refunds/UPI',
  'CUSTOMER NAME\tSELF',
].join('\n');

function parseSavings(text: string): ParsedStatement & { accountType: 'savings' } {
  const attempt = runDeterministicParser(parserInputFor(text));
  expect(attempt?.error).toBeNull();
  const statement = attempt?.output?.statement;
  if (!statement || statement.accountType !== 'savings') {
    throw new Error('expected a savings statement');
  }
  return statement;
}

describe('detection', () => {
  it.each([
    ['the centred layout', CENTRED_LAYOUT],
    ['the split layout', SPLIT_LAYOUT],
  ])('recognises %s from IDFC markers', (_name, text) => {
    const { detection } = parserInputFor(text);
    expect(detection.parserId).toBe('idfc-savings');
    expect(detection.accountType).toBe('savings');
    expect(detection.issuer).toBe('IDFC FIRST Bank');
  });
});

describe('idfc-savings parser — the centred layout', () => {
  it('reads the period from the page header', () => {
    const statement = parseSavings(CENTRED_LAYOUT);
    expect(statement.periodStart).toBe('2025-10-01');
    expect(statement.periodEnd).toBe('2025-10-31');
  });

  it('reads the summary strip past the two counts sitting in it', () => {
    // `001` and `002` are tallies of withdrawals and deposits, printed between
    // the amounts. Reading the strip by column puts the whole thing one out.
    const { savings } = parseSavings(CENTRED_LAYOUT);
    expect(savings).toMatchObject({
      openingBalanceMinor: 100_000,
      totalDebitsMinor: 50_000,
      interestEarnedMinor: 10_000,
      closingBalanceMinor: 120_000,
    });
  });

  it('takes the interest back out of the deposits total', () => {
    // IDFC has one Deposits column and the interest credit is a row inside it,
    // where slice gives interest a column of its own. Reconciliation adds
    // credits and interest, so leaving it in makes every statement short by
    // exactly the interest it earned.
    const { savings } = parseSavings(CENTRED_LAYOUT);
    expect(savings.totalCreditsMinor + savings.interestEarnedMinor).toBe(70_000);
    expect(savings.totalCreditsMinor).toBe(60_000);
  });

  it('keeps only the last four digits of the account number', () => {
    const { account } = parseSavings(CENTRED_LAYOUT);
    expect(account.last4).toBe('4321');
    expect(account.maskedNumber).toBe('XXXX4321');
    expect(account.openedAt).toBe('2025-08-04');
  });

  it('reads every row, and reconciles', () => {
    const statement = parseSavings(CENTRED_LAYOUT);
    expect(statement.transactions).toHaveLength(3);
    expect(reconcile(statement).ok).toBe(true);
  });

  it('gets direction from the balance moving, not from a column', () => {
    // The withdrawals and deposits columns are separate and an empty one is
    // not printed, so by the time the parser sees a row the amount is just a
    // number with nothing saying which way it went.
    const statement = parseSavings(CENTRED_LAYOUT);
    expect(statement.transactions[0]).toMatchObject({
      date: '2025-10-01',
      amountMinor: 50_000,
      direction: 'debit',
    });
    expect(statement.transactions[1]).toMatchObject({
      date: '2025-10-02',
      amountMinor: 60_000,
      direction: 'credit',
    });
  });

  it('rebuilds a description from the lines either side of its row', () => {
    // This is what the centring rule is for. `UPI/DR/…/GROCER` sits above the
    // money row, `Y MART/…` is a cell on it, and `/UPI` is below — one
    // description, printed around the figures it belongs to.
    const statement = parseSavings(CENTRED_LAYOUT);
    expect(statement.transactions[0]?.descriptionRaw).toBe(
      'UPI/DR/900000000001/GROCERY MART/ICIC/grocery/pay/UPI',
    );
    expect(statement.transactions[0]?.merchant).toBe('GROCERY MART');
  });

  it('marks the interest credit, which has no description cell of its own', () => {
    const statement = parseSavings(CENTRED_LAYOUT);
    const interest = statement.transactions.filter((txn) => txn.isInterest);
    expect(interest).toHaveLength(1);
    expect(interest[0]).toMatchObject({
      date: '2025-10-31',
      direction: 'credit',
      amountMinor: 10_000,
      mode: 'interest',
      merchant: 'Interest credited',
      descriptionRaw: 'MONTHLY SAVINGSINTEREST CREDIT',
    });
  });
});

describe('idfc-savings parser — the split layout', () => {
  it('reads a statement that spreads the date and time over three lines', () => {
    // Here the date is on the line above the money row and the time on the one
    // below. Cell position is useless; the row carrying the running balance is
    // the only fixed point.
    const statement = parseSavings(SPLIT_LAYOUT);
    expect(statement.periodStart).toBe('2025-12-01');
    expect(statement.transactions).toHaveLength(2);
    expect(reconcile(statement).ok).toBe(true);
  });

  it('dates rows from the transaction date, not the time below it', () => {
    const statement = parseSavings(SPLIT_LAYOUT);
    expect(statement.transactions[0]).toMatchObject({
      date: '2025-12-01',
      direction: 'debit',
      amountMinor: 80_000,
    });
    expect(statement.transactions[1]).toMatchObject({
      date: '2025-12-05',
      direction: 'credit',
      amountMinor: 30_000,
    });
  });

  it('pulls the counterparty out of the slash-separated description', () => {
    const statement = parseSavings(SPLIT_LAYOUT);
    expect(statement.transactions.map((txn) => txn.merchant)).toEqual(['BOOKSHOP', 'REFUNDCO']);
  });
});

describe('what the parser must always hold to', () => {
  it.each([
    ['the centred layout', CENTRED_LAYOUT],
    ['the split layout', SPLIT_LAYOUT],
  ])('produces a statement from %s that validates against the schema', (_name, text) => {
    expect(() => parsedStatementSchema.parse(parseSavings(text))).not.toThrow();
  });

  it.each([
    ['the centred layout', CENTRED_LAYOUT],
    ['the split layout', SPLIT_LAYOUT],
  ])('agrees with its own running balance on every row of %s', (_name, text) => {
    // The parser warns when a row moves the balance by anything other than the
    // amount it states. No warning is a per-row check of every amount and
    // direction, not just of the summary totals.
    const attempt = runDeterministicParser(parserInputFor(text));
    expect(attempt?.output?.warnings ?? []).toEqual([]);
  });

  it('says so, rather than guessing, when the table header is missing', () => {
    const broken = CENTRED_LAYOUT.split('\n')
      .filter((line) => !line.startsWith('Date and Time'))
      .join('\n');
    const attempt = runDeterministicParser(parserInputFor(broken));
    expect(attempt?.error).toMatch(/transaction table header/i);
    expect(attempt?.output).toBeNull();
  });
});
