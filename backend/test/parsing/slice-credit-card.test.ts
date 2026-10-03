import { describe, expect, it } from 'vitest';
import { parserInputFor, runDeterministicParser } from '../../src/parsing/registry.js';
import { reconcile } from '../../src/domain/reconcile.js';
import { parsedStatementSchema, type ParsedStatement } from '../../src/domain/schemas.js';

/**
 * Written by hand rather than cut from a real statement.
 *
 * The figures are invented; the shape is not. It keeps the three things that
 * make this statement awkward — a cycle printed with no year, a spend spread
 * over three lines with an avatar letter in the middle, and a minimum-due row
 * glued to its amount with no separator — so the parser is still held to the
 * layout it was written against.
 */
const STATEMENT = [
  '@@PAGE 1',
  "SELF's",
  'Credit card statement',
  'X X X X\tX X X X\tX X X X\t8 7 6 5',
  '03 SEP - 02 OCT',
  '₹600.00',
  'Repay',
  'Due on 18 Oct',
  'Statement summary',
  'Spends\t₹500.00',
  'Refunds & repayments\t₹50.00',
  'Interest\t₹30.00',
  'Surcharge\t₹20.00',
  'Carry forward\t₹100.00',
  'Total amount due\t₹600.00',
  // Printed with no separator between label and amount, unlike every row above.
  'Min amount due₹250.00',
  '@@PAGE 2',
  'Spends',
  'Corner Store\t₹300',
  'C',
  "2 Oct '26 • UPI",
  'A Very Long Merchant Nam…\t₹150',
  'A',
  "29 Sep '26 • UPI",
  'Fuel Stop\t₹50',
  'F',
  "19 Sep '26 • Card",
  '@@PAGE 3',
  'GST details',
  'IGST\t₹0',
  'monies',
  'Earned\t500',
  '03 Sep - 02 Oct',
  '@@PAGE 4',
  'Glossary',
  'Payment obligations',
  'refer to the slice credit card MITC for how your MAD is calculated.',
].join('\n');

/** The same cycle a month later, to pin the year roll-over on its own. */
const NEW_YEAR_STATEMENT = STATEMENT.replace('03 SEP - 02 OCT', '03 DEC - 02 JAN')
  .replace('Due on 18 Oct', 'Due on 18 Jan')
  .replace("2 Oct '26 • UPI", "2 Jan '27 • UPI")
  .replace("29 Sep '26 • UPI", "29 Dec '26 • UPI")
  .replace("19 Sep '26 • Card", "19 Dec '26 • Card");

function parseCard(text: string): ParsedStatement & { accountType: 'credit_card' } {
  const attempt = runDeterministicParser(parserInputFor(text));
  expect(attempt?.error).toBeNull();
  const statement = attempt?.output?.statement;
  if (!statement || statement.accountType !== 'credit_card') {
    throw new Error('expected a credit card statement');
  }
  return statement;
}

describe('detection', () => {
  it('recognises the slice credit card statement', () => {
    const { detection } = parserInputFor(STATEMENT);
    expect(detection.parserId).toBe('slice-credit-card');
    expect(detection.accountType).toBe('credit_card');
    expect(detection.issuer).toBe('slice');
  });

  it('does not answer for the slice savings statement, which is the same issuer', () => {
    // The two documents share a bank and nothing else: one is a ledger with a
    // running balance, the other a receipt. Routing a savings statement into
    // this parser would read its closing balance as a card's amount due.
    const savings = [
      '@@PAGE 1',
      'slice small finance bank',
      'Savings account statement',
      "01 Jul '26 - 31 Jul '26",
      'OPENING BALANCE\tCLOSING BALANCE',
      'Interest Cr. for 30-Jun-2026',
    ].join('\n');
    expect(parserInputFor(savings).detection.parserId).not.toBe('slice-credit-card');
  });
});

describe('slice-credit-card parser', () => {
  it('dates the cycle from the transactions, since the cycle has no year', () => {
    // `03 SEP - 02 OCT` is the whole of what the statement prints. Only the
    // spends carry a year, so they are what the period is anchored to.
    const statement = parseCard(STATEMENT);
    expect(statement.periodStart).toBe('2026-09-03');
    expect(statement.periodEnd).toBe('2026-10-02');
  });

  it('puts the due date in the year the cycle closes, not the year it opens', () => {
    expect(parseCard(STATEMENT).dueDate).toBe('2026-10-18');
  });

  it('walks the year back when a cycle crosses New Year', () => {
    // `03 DEC - 02 JAN` opens in a later month than it closes, which can only
    // mean the previous year — and the due date then falls after the roll-over.
    const statement = parseCard(NEW_YEAR_STATEMENT);
    expect(statement.periodStart).toBe('2026-12-03');
    expect(statement.periodEnd).toBe('2027-01-02');
    expect(statement.dueDate).toBe('2027-01-18');
  });

  it('reads the card number printed as spaced digits', () => {
    const { account } = parseCard(STATEMENT);
    expect(account.last4).toBe('8765');
    expect(account.maskedNumber).toBe('XXXX8765');
  });

  it('maps each summary label to the field it belongs in', () => {
    const { card } = parseCard(STATEMENT);
    expect(card.purchasesMinor).toBe(50_000);
    expect(card.creditsMinor).toBe(5_000);
    expect(card.previousBalanceMinor).toBe(10_000);
    // Interest and surcharge are both charges that are neither a purchase nor
    // a cash advance, which is what other-debits means to the equation.
    expect(card.otherDebitsMinor).toBe(5_000);
    expect(card.totalDueMinor).toBe(60_000);
  });

  it('reads the minimum due even though it is glued to its label', () => {
    expect(parseCard(STATEMENT).card.minimumDueMinor).toBe(25_000);
  });

  it('reconciles', () => {
    // 100 carried + 500 spent + 50 charged − 50 refunded = 600 due.
    expect(reconcile(parseCard(STATEMENT)).ok).toBe(true);
  });

  it('reads a spend from the three lines it is printed across', () => {
    const statement = parseCard(STATEMENT);
    expect(statement.transactions).toHaveLength(3);
    expect(statement.transactions[0]).toMatchObject({
      date: '2026-10-02',
      merchant: 'Corner Store',
      amountMinor: 30_000,
      direction: 'debit',
      mode: 'upi',
    });
  });

  it('skips the avatar letter between a spend and its date', () => {
    // The single capital under each row is the merchant's own initial. Read as
    // a row it would be a spend with no amount; read as a merchant it would be
    // "C".
    const merchants = parseCard(STATEMENT).transactions.map((txn) => txn.merchant);
    expect(merchants).not.toContain('C');
    expect(merchants).toEqual(['Corner Store', 'A Very Long Merchant Nam', 'Fuel Stop']);
  });

  it('drops the ellipsis the bank adds when it truncates a name', () => {
    const statement = parseCard(STATEMENT);
    expect(statement.transactions[1]?.merchant).toBe('A Very Long Merchant Nam');
    expect(statement.transactions[1]?.merchant).not.toMatch(/…/u);
  });

  it('reads the mode off the date line', () => {
    const modes = parseCard(STATEMENT).transactions.map((txn) => txn.mode);
    expect(modes).toEqual(['upi', 'upi', 'card']);
  });

  it('leaves cashback at zero, because monies are points and not rupees', () => {
    // The statement credits 500 "monies" for ₹500 of spend. They are a reward
    // balance; putting them in a paise field would have the app spend them.
    const { card } = parseCard(STATEMENT);
    expect(card.cashbackEarnedMinor).toBe(0);
    expect(card.cashbackCreditedMinor).toBe(0);
  });
});

describe('what the parser must always hold to', () => {
  it('produces a statement that validates against the schema', () => {
    expect(() => parsedStatementSchema.parse(parseCard(STATEMENT))).not.toThrow();
  });

  it('raises no warning on a statement it fully understands', () => {
    const attempt = runDeterministicParser(parserInputFor(STATEMENT));
    expect(attempt?.output?.warnings ?? []).toEqual([]);
  });

  it('says so when the spends do not add up to the summary', () => {
    const tampered = STATEMENT.replace('Corner Store\t₹300', 'Corner Store\t₹299');
    const attempt = runDeterministicParser(parserInputFor(tampered));
    expect(attempt?.output?.warnings.map((warning) => warning.code)).toContain('spends_mismatch');
  });

  it('reports a summary row it has never seen rather than dropping it', () => {
    // Only one real statement exists to write this against, and the glossary
    // names rows that do not appear when they are zero. A new label must be
    // heard about, not silently left out of figures that then fail to add up.
    const extra = STATEMENT.replace('Interest\t₹30.00', 'Interest\t₹30.00\nMystery charge\t₹5.00');
    const attempt = runDeterministicParser(parserInputFor(extra));
    expect(attempt?.output?.warnings.map((warning) => warning.code)).toContain(
      'unknown_summary_row',
    );
  });

  it('refuses rather than guessing when the summary has no total', () => {
    const broken = STATEMENT.replace('Total amount due\t₹600.00', '');
    const attempt = runDeterministicParser(parserInputFor(broken));
    expect(attempt?.error).toMatch(/Total amount due/i);
    expect(attempt?.output).toBeNull();
  });
});
