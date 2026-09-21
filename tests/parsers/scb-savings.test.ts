import { describe, expect, it } from 'vitest';
import { parserInputFor, runDeterministicParser } from '@/server/parsing/registry';
import { reconcile } from '@/server/domain/reconcile';
import { parsedStatementSchema, type ParsedStatement } from '@/server/domain/schemas';

/**
 * Invented, not redacted — see the note in the IDFC parser's tests. The parser
 * was written against seven real Standard Chartered statements and is
 * committed with none of them; what the tests need is the layout, and the
 * layout can be written by hand.
 *
 * Arranged the way the bank arranges it: the summary living in the first and
 * last rows of the table rather than in a strip of its own, a two-column
 * header, and a payer's name wrapped over continuation lines that follow the
 * row instead of surrounding it.
 */
const STATEMENT = [
  '@@PAGE 1',
  // The two-column header: address block on the left, labelled fields on the
  // right, sharing rows. There is no bare line holding the holder's name.
  'SELF\tBRANCH\t:\tCentral Branch',
  '[address]\tSTATEMENT DATE\t:\t30 Nov 2025',
  '[address]\tCURRENCY\t:\tINR',
  '[address]\tACCOUNT TYPE\t:\tSMART BANKING',
  'SAVINGS ACCOUNT',
  'ACCOUNT : XXXX8765',
  'MICR: [micr] IFSC: [ifsc]',
  'Standard Chartered Bank',
  // "Value" and "Date" are the two halves of one column heading, printed above
  // and below the header row.
  'Value',
  'Date\tDescription\tCheque\tDeposit\tWithdrawal\tBalance',
  'Date',
  '01 Nov 2025\t01 Nov 2025\tBALANCE FORWARD\t100.00',
  // A salary credit: the payer's name is wrapped over two lines and sits
  // between two copies of the transfer reference.
  '17 Nov 2025\t17 Nov 2025\tBT REF90001\t5,000.00\t5,100.00',
  'ACME PAYROLL PRIVATE',
  'LIMITED STANDARD CHARTE',
  'REF90001',
  'SAL NOV 25',
  '20 Nov 2025\t20 Nov 2025\tUPI/900000000005/\t4,000.00\t1,100.00',
  'SELF,',
  '/[vpa],/',
  '28 Nov 2025\t28 Nov 2025\tIGST @18.00%\t10.00\t1,090.00',
  'ON ATM/POS DECLINE',
  '30 Nov 2025\t30 Nov 2025\tSAVING A/C CREDIT INTEREST\t20.00\t1,110.00',
  'Total\t5,020.00\t4,010.00\t1,110.00',
  'SELF\tPage1of2',
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
  it('recognises a Standard Chartered statement from its own markers', () => {
    const { detection } = parserInputFor(STATEMENT);
    expect(detection.parserId).toBe('scb-savings');
    expect(detection.accountType).toBe('savings');
    expect(detection.issuer).toBe('Standard Chartered');
  });
});

describe('scb-savings parser', () => {
  it('takes the period from the statement date and the opening row', () => {
    // This statement never prints a range. The end is the statement date in
    // the header — which is not in the first cell of its row — and the start
    // is whatever day the BALANCE FORWARD row is dated.
    const statement = parseSavings(STATEMENT);
    expect(statement.periodStart).toBe('2025-11-01');
    expect(statement.periodEnd).toBe('2025-11-30');
  });

  it('reads the summary off the first and last rows of the table', () => {
    // There is no summary strip: BALANCE FORWARD opens the table carrying the
    // opening balance and a Total row closes it with everything else.
    const { savings } = parseSavings(STATEMENT);
    expect(savings).toMatchObject({
      openingBalanceMinor: 10_000,
      totalDebitsMinor: 401_000,
      closingBalanceMinor: 111_000,
    });
  });

  it('takes the interest back out of the deposits total', () => {
    // One Deposits column with the interest row inside it, and reconciliation
    // adds credits and interest. Counted twice the statement is over by
    // exactly the interest it earned.
    const { savings } = parseSavings(STATEMENT);
    expect(savings.interestEarnedMinor).toBe(2_000);
    expect(savings.totalCreditsMinor).toBe(500_000);
    expect(reconcile(parseSavings(STATEMENT)).ok).toBe(true);
  });

  it('keeps only the last four digits of the account number', () => {
    const { account } = parseSavings(STATEMENT);
    expect(account.last4).toBe('8765');
    expect(account.maskedNumber).toBe('XXXX8765');
  });

  it('reads every row, and ignores the page furniture between them', () => {
    // `Value`, `Date` and a repeated column header all sit inside the table.
    // Left in, they would be read as continuation text belonging to whichever
    // transaction came before.
    const statement = parseSavings(STATEMENT);
    expect(statement.transactions).toHaveLength(4);
    expect(reconcile(statement).ok).toBe(true);
  });

  it('gets direction from the balance moving, not from a column', () => {
    const statement = parseSavings(STATEMENT);
    expect(statement.transactions[0]).toMatchObject({
      direction: 'credit',
      amountMinor: 500_000,
    });
    expect(statement.transactions[1]).toMatchObject({ direction: 'debit', amountMinor: 400_000 });
  });

  it('names the payer behind a salary credit', () => {
    const statement = parseSavings(STATEMENT);
    expect(statement.transactions[0]?.merchant).toBe('ACME PAYROLL PRIVATE LIMITED');
  });

  it('joins continuation lines with a space, unlike the other banks', () => {
    // These are separate fields broken at spaces, not one hard-wrapped string.
    // Running them together the way slice and IDFC require would give
    // `PRIVATELIMITED`.
    const statement = parseSavings(STATEMENT);
    expect(statement.transactions[0]?.descriptionRaw).toContain('ACME PAYROLL PRIVATE LIMITED');
  });

  it('drops the bank reference code from a counterparty', () => {
    // `REF90001` is a code glued to a number. No company is named like one,
    // and left in it makes every transfer look like a different payee.
    const statement = parseSavings(STATEMENT);
    for (const txn of statement.transactions) {
      expect(txn.merchant).not.toMatch(/REF9/);
    }
  });

  it('marks a charge as a fee', () => {
    const statement = parseSavings(STATEMENT);
    const igst = statement.transactions.find((txn) => txn.descriptionRaw.startsWith('IGST'));
    expect(igst).toMatchObject({ isFee: true, direction: 'debit', amountMinor: 1_000 });
    expect(igst?.merchant).toBe('IGST');
  });

  it('marks the interest credit', () => {
    const statement = parseSavings(STATEMENT);
    const interest = statement.transactions.filter((txn) => txn.isInterest);
    expect(interest).toHaveLength(1);
    expect(interest[0]).toMatchObject({
      date: '2025-11-30',
      direction: 'credit',
      amountMinor: 2_000,
      mode: 'interest',
      merchant: 'Interest credited',
    });
  });
});

describe('what the parser must always hold to', () => {
  it('produces a statement that validates against the schema', () => {
    expect(() => parsedStatementSchema.parse(parseSavings(STATEMENT))).not.toThrow();
  });

  it('agrees with its own running balance on every row', () => {
    const attempt = runDeterministicParser(parserInputFor(STATEMENT));
    expect(attempt?.output?.warnings ?? []).toEqual([]);
  });

  it('says so, rather than guessing, when the Total row is missing', () => {
    // That row is both the closing figures and the end of the transactions, so
    // there is nothing to fall back on if it is not there.
    const broken = STATEMENT.split('\n')
      .filter((line) => !line.startsWith('Total'))
      .join('\n');
    const attempt = runDeterministicParser(parserInputFor(broken));
    expect(attempt?.error).toMatch(/Total row/i);
    expect(attempt?.output).toBeNull();
  });
});
