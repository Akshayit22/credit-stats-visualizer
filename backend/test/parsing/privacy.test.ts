import { readFileSync } from 'node:fs';
import { findPiiLeaks, redactForLlm, redactForStorage } from '@cred-stats/shared';
import { describe, expect, it } from 'vitest';
import { runDeterministicParser } from '../../src/parsing/registry.js';
import {
  FIXTURES_DIR,
  FIXTURE_NAMES,
  fixtureFiles,
  fixtureInput,
  fixtureText,
} from '../helpers/fixtures.js';

/**
 * These are the tests that stop a privacy regression from shipping. They run
 * against the committed fixtures — which came from the author's own real
 * statements — so a hole in the redaction rules fails the build. The rules
 * themselves are tested case by case in `shared/test/redact.test.ts`.
 */

const FIXTURE_FILES = fixtureFiles();

describe('the committed fixtures', () => {
  it('exist — otherwise every other test here is vacuous', () => {
    expect(FIXTURE_FILES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(FIXTURE_FILES)('%s carries no identifier we promise not to keep', (file) => {
    const text = readFileSync(new URL(file, `file://${FIXTURES_DIR}`), 'utf8');
    expect(findPiiLeaks(text)).toEqual([]);
  });

  it.each(FIXTURE_FILES)('%s carries no full account or card number', (file) => {
    const text = readFileSync(new URL(file, `file://${FIXTURES_DIR}`), 'utf8');
    // The real numbers behind these statements.
    expect(text).not.toContain('033325225226993');
    expect(text).not.toContain('652984');
    expect(text).not.toContain('380009067496');
  });

  it.each(FIXTURE_FILES)('%s carries no holder name, address or nominee', (file) => {
    const text = readFileSync(new URL(file, `file://${FIXTURES_DIR}`), 'utf8');
    expect(text).not.toMatch(/AKSHAY/i);
    // Fragments too: a bank wraps a name mid-word, and "TELAN" is as much a
    // leak as "TELANG".
    expect(text).not.toMatch(/TELAN/i);
    expect(text).not.toMatch(/LALUMAN/i);
    expect(text).not.toMatch(/LUMAN/i);
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
      expect(blob).not.toMatch(/TELAN/i);
      expect(blob).not.toMatch(/LUMAN/i);
      // The seam bug: a name truncated by a line wrap must not survive as
      // "SELFLAN" once the continuation is joined on.
      expect(blob).not.toMatch(/SELF[A-Z]/);
      expect(findPiiLeaks(blob, 'fragment')).toEqual([]);
    }

    expect(statement.account.maskedNumber).toMatch(/^XXXX\d{4}$/);
    expect(statement.account.last4).toMatch(/^\d{4}$/);
  });
});

describe('redaction over a whole real statement', () => {
  it.each(Object.values(FIXTURE_NAMES))(
    '%s: the server pass over the client pass changes nothing and removes nothing',
    (name) => {
      const once = redactForStorage(fixtureText(name)).text;
      const twice = redactForStorage(once);
      expect(twice.text).toBe(once);
      expect(twice.counts).toEqual({});
    },
  );

  it('leaves a prompt with nothing identifying in it', () => {
    const prompt = redactForLlm(fixtureText(FIXTURE_NAMES.sliceJul));
    expect(findPiiLeaks(prompt)).toEqual([]);
    expect(prompt).not.toMatch(/AKSHAY|TELANG|PUSHPANJALI/i);
    expect(prompt).not.toMatch(/\b\d{9,}\b/);
  });
});
