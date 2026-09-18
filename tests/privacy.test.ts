import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixtureInput, fixtureText } from './fixtures';
import {
  detectHolderNames,
  findPiiLeaks,
  holderNamePattern,
  joinWrappedDetail,
  redactForLlm,
  redactForStorage,
} from '@/shared/redact';
import { runDeterministicParser } from '@/server/parsing/registry';

/**
 * These are the tests that stop a privacy regression from shipping. They run
 * against the committed fixtures — which came from the author's own real
 * statements — so a hole in the redaction rules fails the build.
 */

const FIXTURE_FILES = readdirSync(resolve('fixtures')).filter((name) => name.endsWith('.txt'));

describe('the committed fixtures', () => {
  it('exist — otherwise every other test here is vacuous', () => {
    expect(FIXTURE_FILES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(FIXTURE_FILES)('%s carries no identifier we promise not to keep', (file) => {
    const text = readFileSync(resolve('fixtures', file), 'utf8');
    expect(findPiiLeaks(text)).toEqual([]);
  });

  it.each(FIXTURE_FILES)('%s carries no full account or card number', (file) => {
    const text = readFileSync(resolve('fixtures', file), 'utf8');
    // The real numbers behind these statements.
    expect(text).not.toContain('033325225226993');
    expect(text).not.toContain('652984');
    expect(text).not.toContain('380009067496');
  });

  it.each(FIXTURE_FILES)('%s carries no holder name, address or nominee', (file) => {
    const text = readFileSync(resolve('fixtures', file), 'utf8');
    expect(text).not.toMatch(/AKSHAY/i);
    expect(text).not.toMatch(/TELANG/i);
    expect(text).not.toMatch(/PUSHPANJALI/i);
    expect(text).not.toMatch(/VADAPALANI/i);
    expect(text).not.toMatch(/Vanita/i);
    expect(text).not.toMatch(/8698934921/);
  });
});

describe('the parsed output', () => {
  it.each(Object.values(FIXTURE_NAMES))('%s leaks nothing into a transaction', (name) => {
    const attempt = runDeterministicParser(fixtureInput(name));
    const statement = attempt?.output?.statement;
    expect(statement).toBeDefined();
    if (!statement) return;

    for (const txn of statement.transactions) {
      const blob = `${txn.descriptionRaw} ${txn.merchant} ${txn.counterparty}`;
      expect(blob).not.toMatch(/AKSHAY/i);
      expect(blob).not.toMatch(/TELANG/i);
      // The seam bug: a name truncated by a line wrap must not survive as
      // "SELFLAN" once the continuation is joined on.
      expect(blob).not.toMatch(/SELF[A-Z]/);
      expect(findPiiLeaks(blob, 'fragment')).toEqual([]);
    }

    expect(statement.account.maskedNumber).toMatch(/^XXXX\d{4}$/);
    expect(statement.account.last4).toMatch(/^\d{4}$/);
  });
});

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

  it('is idempotent — the server pass over the client pass changes nothing', () => {
    const once = redactForStorage(fixtureText(FIXTURE_NAMES.sliceAug)).text;
    const twice = redactForStorage(once).text;
    expect(twice).toBe(once);
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

  it('leaves a prompt with nothing identifying in it', () => {
    const prompt = redactForLlm(fixtureText(FIXTURE_NAMES.sliceJul));
    expect(findPiiLeaks(prompt)).toEqual([]);
    expect(prompt).not.toMatch(/AKSHAY|TELANG|PUSHPANJALI/i);
    expect(prompt).not.toMatch(/\b\d{9,}\b/);
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
  });
});
