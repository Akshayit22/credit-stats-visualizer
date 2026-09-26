import { describe, expect, it } from 'vitest';
import {
  detectHolderNames,
  holderNamePattern,
  holderTokenPatterns,
  joinWrappedDetail,
  redactForLlm,
  redactForStorage,
  redactFreeText,
} from '../src/redact.js';

/**
 * The redaction rules on their own, against hand-written lines shaped like the
 * real statements. The fixture-level checks — that no committed fixture and no
 * parsed transaction carries PII — live with the parsers in the backend.
 */

describe('holder-name matching', () => {
  it('finds the name a statement prints at the top', () => {
    // The committed fixture is already redacted, so this uses the same shape
    // the raw extraction has: issuer line, then the holder, then the address.
    const raw = [
      '@@PAGE 1',
      'AXIS BANK SUPERMONEY RuPay Credit Card',
      'PRIYA RAMACHANDRAN NAIR',
      '14, SECOND CROSS, INDIRANAGAR,',
      'BENGALURU 560038',
    ].join('\n');
    expect(detectHolderNames(raw)).toEqual(['PRIYA RAMACHANDRAN NAIR']);
  });

  it('finds a name from a labelled Name row too', () => {
    const raw = '@@PAGE 1\nCard No:\tXXXX9581\tName\tPRIYA RAMACHANDRAN NAIR';
    expect(detectHolderNames(raw)).toContain('PRIYA RAMACHANDRAN NAIR');
  });

  it('matches the truncated forms bank PDFs print', () => {
    const pattern = holderNamePattern('AKSHAY LALUMAN TELANG');
    expect(pattern).not.toBeNull();
    if (!pattern) return;
    const test = (value: string) => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    };
    expect(test('AKSHAY LALUMAN TELANG')).toBe(true);
    expect(test('AKSHAY LALUMAN TELAN')).toBe(true);
    expect(test('Mr. Akshay Laluman T')).toBe(true);
    expect(test('AKSHAY LALUMAN')).toBe(true);
    expect(test('AKSHAY')).toBe(true);
    // Someone else with the same first name is not this person's full name, but
    // redacting more than we must is the safe direction, so this matches the
    // first token only — which is the behaviour we want and are asserting.
    expect(test('AKSHAY KUMAR')).toBe(true);
    expect(test('VANITA TELANG')).toBe(false);
  });

  it('does not mistake an all-caps heading for a name', () => {
    expect(detectHolderNames('IMPORTANT MESSAGE\nPAYMENT SUMMARY\nCASHBACK DETAILS')).toEqual([]);
  });

  it('finds a title-case name behind an honorific', () => {
    // IDFC prints the holder in title case. An all-caps-only test found
    // nothing here and the name travelled into the prompt — silently, because
    // "no holder detected" is indistinguishable from "no holder printed".
    const raw = [
      '@@PAGE 1',
      'CONSOLIDATED STATEMENT',
      'CUSTOMER ID\t[customer-id]',
      'Mr. Akshay Laluman Telang',
      'Phule Nagar Panchvati Panchvati',
    ].join('\n');
    expect(detectHolderNames(raw)).toEqual(['Mr. Akshay Laluman Telang']);
  });

  it('leaves a bare title-case line alone when nothing marks it as a person', () => {
    // The address in that same header is title case too. Taking it would both
    // miss the real name and corrupt the line, so an honorific is required.
    const raw = '@@PAGE 1\nConsolidated Statement\nPhule Nagar Panchvati\nNashik India';
    expect(detectHolderNames(raw)).toEqual([]);
  });

  it('masks each word of the name on its own, for the wraps a line pass cannot see', () => {
    // IDFC spreads one description over three printed lines with the data row
    // in the middle, stranding `LALUMAN` and `TELANG` in a cell that neither
    // the whole-name pattern nor the spill logic reaches.
    const raw = [
      '@@PAGE 1',
      'Mr. Akshay Laluman Telang',
      'NEFT/IDFB527549230399/AKS',
      '01 Oct 25 19:23\t01 Oct 25\tHAY LALUMAN\t100,000.00\t592,635.00 CR',
      'TELANG/SBIN00',
    ].join('\n');
    const out = redactForStorage(raw).text;
    expect(out).not.toMatch(/LALUMAN/i);
    expect(out).not.toMatch(/TELANG/i);
  });

  it('gives a short word no standalone pattern of its own', () => {
    // The five-character floor. A standalone `\bRam\b` would match every
    // `RAM ENTERPRISES` in the file; the whole-name pattern is anchored by the
    // rest of the name and can afford to be greedy, a lone word cannot.
    expect(holderTokenPatterns('Mr. Ram Iyer')).toEqual([]);
    expect(holderTokenPatterns('Mr. Akshay Laluman Telang').map((r) => r.source)).toEqual([
      '\\bAkshay\\b',
      '\\bLaluman\\b',
      '\\bTelang\\b',
    ]);
  });

  it('matches a whole word wherever it landed, in any case', () => {
    const [pattern] = holderTokenPatterns('Mr. Akshay Laluman Telang').slice(1);
    expect(pattern).toBeDefined();
    if (!pattern) return;
    pattern.lastIndex = 0;
    expect(pattern.test('HAY LALUMAN')).toBe(true);
  });
});

describe('redactForStorage', () => {
  it('keeps the labels the parsers need while replacing the values', () => {
    const { text } = redactForStorage(
      ['@@PAGE 1', 'Customer ID\t380009067496\tAccount\tSAVING', 'Phone\t9876543210'].join('\n'),
    );
    expect(text).toContain('Customer ID');
    expect(text).toContain('Account\tSAVING');
    expect(text).not.toContain('380009067496');
    expect(text).not.toContain('9876543210');
  });

  it('keeps only the last four of an account number', () => {
    const { text } = redactForStorage('@@PAGE 1\nA/C number\t033325225226993');
    expect(text).toContain('XXXX6993');
    expect(text).not.toContain('033325225226993');
  });

  it('leaves merchant text alone, because categorisation needs it', () => {
    const { text } = redactForStorage(
      '@@PAGE 1\nDATE\tDETAILS\tAMOUNT\n25/05/2026\tUPI/SWIGGY/swiggy@icici\t400.00 Dr',
    );
    expect(text).toContain('SWIGGY');
  });
});

describe('redactForLlm', () => {
  it('additionally strips the long reference ids a model has no use for', () => {
    const stored = 'UPI-Debit-621350153143-CheQ-[ifsc]\t2026080414026601\t-₹5,733.00';
    const forPrompt = redactForLlm(stored);
    expect(forPrompt).not.toContain('621350153143');
    expect(forPrompt).not.toContain('2026080414026601');
    expect(forPrompt).toContain('CheQ');
  });
});

describe('joinWrappedDetail', () => {
  it('joins with no separator, because the bank wraps mid-word', () => {
    expect(joinWrappedDetail('Payment from slic', 'e')).toBe('Payment from slice');
  });

  it('keeps a masked value’s tail with the mask', () => {
    expect(joinWrappedDetail('UPI-Debit-1234-SELF', 'LAN-SBIN0010486')).toBe(
      'UPI-Debit-1234-SELF-SBIN0010486',
    );
    expect(joinWrappedDetail('to [phone]', '4921-XXX')).toBe('to [phone]-XXX');
    // The tail can carry a space — "…AKSHAY LA" + "LUMAN TELAN-XXXX9652" —
    // and the whole run up to the delimiter belongs to the masked value.
    expect(joinWrappedDetail('TO SELF', 'LUMAN TELAN-XXXX9652-IMPS')).toBe('TO SELF-XXXX9652-IMPS');
  });
});

describe('a name broken across a line break', () => {
  // The holder pattern needs the first name whole, so a bank that wraps
  // `AKSHAY` into `AKS` + `HAY` defeated it from both sides: neither half is a
  // name. Nothing looked wrong until a parser joined the description back
  // together — which IDFC's layout forces — and the name was there again.
  const holder = 'Mr. Akshay Laluman Telang';

  it('masks the halves so rejoining them cannot spell the name', () => {
    const raw = [
      '@@PAGE 1',
      holder,
      'NEFT/IDFB527449212322/AKS',
      '01 Oct 25 19:23\t01 Oct 25\tHAY LALUMAN\t100,000.00\t592,635.00 CR',
      'TELANG/SBIN00',
    ].join('\n');

    const out = redactForStorage(raw).text;
    expect(out).not.toMatch(/AKSHAY/i);
    // And still not once every line is concatenated, which is what the parser
    // does to rebuild a description.
    expect(out.split('\n').join('')).not.toMatch(/AKSHAY/i);
  });

  it('leaves an ordinary wrap that spells nothing alone', () => {
    const raw = ['@@PAGE 1', holder, 'UPI/DR/1/ZERODHA', 'BROKING/ICIC/pay'].join('\n');
    const out = redactForStorage(raw).text;
    expect(out).toContain('ZERODHA');
    expect(out).toContain('BROKING');
  });
});

describe('letters left stranded beside a mask', () => {
  // A parser has to rejoin wrapped lines to read a description at all, and
  // that can spell a name no single line contained. The line passes cannot
  // stop it: they do not know which cells the parser keeps, and here it keeps
  // two name fragments while dropping the dates printed between them.
  it('drops the rest of a name that a rejoin put back', () => {
    expect(redactFreeText('NEFT/IDFB527449212322/AKSHAY SELF/SBIN00')).toBe(
      'NEFT/IDFB527449212322/SELF/SBIN00',
    );
  });

  it('collapses a pile-up of masks into one', () => {
    expect(redactFreeText('NEFT/SCBLH28100511952/SELFSELFSELF/x')).toBe(
      'NEFT/SCBLH28100511952/SELF/x',
    );
  });

  it('takes the trailing remnant too', () => {
    expect(redactFreeText('UPI/CR/1/SELFL/SBIN/SELFt/UPI')).toBe('UPI/CR/1/SELF/SBIN/SELF/UPI');
  });

  it('leaves a counterparty that is merely near a mask', () => {
    // slice writes the holder as its own `-SELF-` segment; nothing is touching
    // it, so nothing is taken.
    expect(redactFreeText('UPI-Debit-621350153143-SELF-[ifsc]-[vpa]')).toBe(
      'UPI-Debit-621350153143-SELF-[ifsc]-[vpa]',
    );
    expect(redactFreeText('UPI/DR/1/SHOBHA D/shobha./From ak')).toBe(
      'UPI/DR/1/SHOBHA D/shobha./From ak',
    );
    expect(redactFreeText('ATM-NFS/CASHWITHDRAWAL/SBIPANCHVATI 2ND ATM')).toBe(
      'ATM-NFS/CASHWITHDRAWAL/SBIPANCHVATI 2ND ATM',
    );
  });
});

describe('an account number printed inside its own label', () => {
  // The labelled-field rules read a label in one cell and the value in the
  // next. IDFC puts both in one cell inside a heading, so nothing matched it
  // and the full number survived into the stored text and a committed fixture.
  it('cuts the digits back to the last four, keeping the label', () => {
    const raw = '@@PAGE 1\nSAVINGS ACCOUNT DETAILS FOR A/C : 12345678901';
    const out = redactForStorage(raw).text;
    expect(out).not.toContain('12345678901');
    expect(out).toContain('XXXX8901');
    // The label has to survive: it is how the parser finds the line at all.
    expect(out).toMatch(/SAVINGS ACCOUNT DETAILS FOR A\/C/);
  });

  it('counts it as an account number, so the review step can say so', () => {
    const { counts } = redactForStorage('@@PAGE 1\nACCOUNT NUMBER : 12345678901');
    expect(counts.accountNumber).toBeGreaterThanOrEqual(1);
  });

  it('leaves a reference number that merely follows a colon', () => {
    // Only an account-ish label triggers this; a UPI reference is not one, and
    // the descriptions are what categorisation reads.
    const raw = '@@PAGE 1\nUPI/DR/527407308477/ZERODHA/ICIC/pay';
    expect(redactForStorage(raw).text).toContain('527407308477');
  });
});

describe('a name printed beside labelled fields', () => {
  // Standard Chartered lays its header out in two columns: the address block
  // down the left, labelled fields on the right, all on the same rows. There
  // is no bare line holding the name, so the bare-line rule found the address
  // instead — masking that as the holder and leaving the real name untouched.
  const header = [
    '@@PAGE 1',
    'MR AKSHAY LALUMAN TELANG\tBRANCH\t:\tAnna Nagar',
    'GHAR NO 20\tSTATEMENT DATE\t:\t30 Nov 2025',
    'PETH ROAD\tCURRENCY\t:\tINR',
    'NEAR HANUMAN MANDIR',
    'Date\tDescription\tCheque\tDeposit\tWithdrawal\tBalance',
  ].join('\n');

  it('finds the holder in the first cell of a labelled row', () => {
    expect(detectHolderNames(header)).toEqual(['MR AKSHAY LALUMAN TELANG']);
  });

  it('does not mistake an address line for the holder', () => {
    // `NEAR HANUMAN MANDIR` is three capitalised words with no digits — the
    // same shape as a name. Taking it is wrong twice over: the address is
    // masked as a person, and the real name loses its only candidate.
    expect(detectHolderNames(header)).not.toContain('NEAR HANUMAN MANDIR');
    expect(redactForStorage(header).text).toContain('NEAR HANUMAN MANDIR');
  });

  it('masks the name everywhere once it is found', () => {
    const out = redactForStorage(`${header}\n01 Nov 2025\tUPI/1/\nMR. AKSHAY LALUMAN TELANG,`).text;
    expect(out).not.toMatch(/AKSHAY|TELANG|LALUMAN/i);
  });
});

describe('where holder detection stops looking', () => {
  it('stops at the transaction table, not at a line count', () => {
    // A wrapped continuation inside the table is bare and capitalised and
    // reads like a name. Standard Chartered wraps `PRESIDIO SOLUTIONS
    // PRIVATE LIMITED` under every salary credit, within the old fixed
    // 28-line window. Masking an employer as the holder would erase the
    // counterparty on exactly the rows worth naming.
    const text = [
      '@@PAGE 1',
      'MR AKSHAY LALUMAN TELANG\tBRANCH\t:\tAnna Nagar',
      'Date\tDescription\tCheque\tDeposit\tWithdrawal\tBalance',
      '17 Nov 2025\t17 Nov 2025\tBT IN1BT25111709LYN\t7,366.63\t7,379.57',
      'PRESIDIO SOLUTIONS PRIVATE',
      'LIMITED STANDARD CHARTE',
    ].join('\n');

    expect(detectHolderNames(text)).toEqual(['MR AKSHAY LALUMAN TELANG']);
    expect(redactForStorage(text).text).toContain('PRESIDIO SOLUTIONS PRIVATE');
  });
});

describe('a MICR code printed inside its own label', () => {
  it('masks it, like the account number beside it', () => {
    // Standard Chartered prints `MICR: 600036009 IFSC: SCBL0036078` in a single
    // cell. The IFSC has a free-text pattern of its own and was masked; the
    // MICR had only a labelled-field rule, which never saw it, so half that
    // line went through untouched.
    const out = redactForStorage('@@PAGE 1\nMICR: 600036009 IFSC: SCBL0036078').text;
    expect(out).not.toContain('600036009');
    expect(out).toContain('[micr]');
    expect(out).toContain('[ifsc]');
  });
});

describe('digits stuck to a mask', () => {
  it('takes a date of birth glued onto the holder name', () => {
    // Standard Chartered prints a transfer alias as `AKSHAYLT15012003` — the
    // name run together with what is plainly a date of birth. Masking the name
    // half alone leaves `SELF15012003`, which still carries it.
    expect(redactFreeText('SC 2510-08012346 SELF15012003 IDFC FIRST BAN')).toBe(
      'SC 2510-08012346 SELF IDFC FIRST BAN',
    );
  });

  it('does not eat the counterparty one word per pass', () => {
    // This ran as a loop until the digits case made the flaw reachable: each
    // round collapsed `SELF <word>` to `SELF`, so a bank whose payer followed
    // the mask lost its name a word at a time. One pass, scanning forward.
    expect(redactFreeText('SELF IDFC FIRST BANK LIMITED')).toBe('SELF IDFC FIRST BANK LIMITED');
  });

  it('leaves a number that is merely nearby', () => {
    expect(redactFreeText('SELF 500')).toBe('SELF 500');
  });
});
