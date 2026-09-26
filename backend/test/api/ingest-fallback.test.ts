import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearMockResponses, setMockResponse } from '../../src/llm/providers/mock.js';
import {
  detectStatement,
  parserInputFor,
  runDeterministicParser,
} from '../../src/parsing/registry.js';
import { FIXTURE_NAMES, fixtureText } from '../helpers/fixtures.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/**
 * The model fallback, end to end through the API: a statement from a bank no
 * built-in parser covers, uploaded, read by the (mock) provider, reconciled,
 * categorised and stored. The mock refuses unless a test registers its answer,
 * so a pipeline that calls the model when it should not fails loudly here.
 */

/**
 * A statement from a bank no deterministic parser covers. Shaped like a real
 * one — labelled summary, a dated transaction table — so detection can still
 * tell it is a savings statement, which is what the LLM hint is built from.
 */
const UNKNOWN_BANK_TEXT = [
  '@@PAGE 1',
  'KAVERI GRAMEENA BANK',
  'Account Statement',
  'Customer ID\t[customer-id]\tAccount\tSAVINGS',
  'A/C number\tXXXX4417\tIFSC\t[ifsc]',
  'Statement period\t01-04-2026 to 30-04-2026',
  'Opening balance\tTotal credits\tTotal debits\tClosing balance',
  '12,500.00\t40,000.00\t18,250.00\t34,250.00',
  'DATE\tPARTICULARS\tWITHDRAWAL\tDEPOSIT\tBALANCE',
  '05-04-2026\tUPI/BLINKIT/blinkit@ybl\t1,250.00\t\t11,250.00',
  '10-04-2026\tNEFT SALARY CREDIT\t\t40,000.00\t51,250.00',
  '21-04-2026\tATM CASH WITHDRAWAL\t17,000.00\t\t34,250.00',
].join('\n');

/** What a model would return for the statement above, if one were configured. */
const LLM_ANSWER = {
  accountType: 'savings',
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  statementDate: '2026-05-01',
  dueDate: null,
  account: {
    type: 'savings',
    issuer: 'Kaveri Grameena Bank',
    productName: 'Savings account',
    last4: '4417',
    maskedNumber: 'XXXX4417',
    creditLimitMinor: null,
    cashLimitMinor: null,
    openedAt: null,
  },
  savings: {
    openingBalanceMinor: 1_250_000,
    totalCreditsMinor: 4_000_000,
    totalDebitsMinor: 1_825_000,
    interestEarnedMinor: 0,
    closingBalanceMinor: 3_425_000,
    generatedAt: '2026-05-01',
  },
  transactions: [
    {
      date: '2026-04-05',
      descriptionRaw: 'UPI/BLINKIT/blinkit@ybl',
      counterparty: 'Blinkit',
      merchant: 'Blinkit',
      issuerCategory: null,
      amountMinor: 125_000,
      direction: 'debit',
      mode: 'upi',
      referenceNo: null,
      balanceAfterMinor: 1_125_000,
      cashbackMinor: null,
      isFee: false,
      isInterest: false,
      isPayment: false,
    },
    {
      date: '2026-04-10',
      descriptionRaw: 'NEFT SALARY CREDIT',
      counterparty: '',
      merchant: 'Neft Salary Credit',
      issuerCategory: null,
      amountMinor: 4_000_000,
      direction: 'credit',
      mode: 'other',
      referenceNo: null,
      balanceAfterMinor: 5_125_000,
      cashbackMinor: null,
      isFee: false,
      isInterest: false,
      isPayment: false,
    },
    {
      date: '2026-04-21',
      descriptionRaw: 'ATM CASH WITHDRAWAL',
      counterparty: '',
      merchant: 'ATM cash withdrawal',
      issuerCategory: null,
      amountMinor: 1_700_000,
      direction: 'debit',
      mode: 'other',
      referenceNo: null,
      balanceAfterMinor: 3_425_000,
      cashbackMinor: null,
      isFee: false,
      isInterest: false,
      isPayment: false,
    },
  ],
};

let testApp: TestApp;

beforeAll(async () => {
  testApp = await createTestApp();
  await testApp.http.post('/api/auth/dev-login').expect(200);
});

afterEach(async () => {
  clearMockResponses();
  // Each case starts from an empty account: delete everything (which also
  // signs out), then sign back in.
  await testApp.http.post('/api/profile/delete').send({ confirm: 'delete my data' }).expect(200);
  await testApp.http.post('/api/auth/dev-login').expect(200);
});

afterAll(async () => {
  await testApp.close();
});

function upload(text: string) {
  return testApp.http.post('/api/statements').send({
    text,
    contentHash: createHash('sha256').update(text).digest('hex'),
    meta: { pageCount: 1, fileName: 'statement.pdf', extractedAt: new Date().toISOString() },
  });
}

describe('a bank no deterministic parser covers', () => {
  it('is recognised as a savings statement even though no parser matches', () => {
    const detection = detectStatement(UNKNOWN_BANK_TEXT);
    expect(detection.parserId).toBeNull();
    expect(detection.accountType).toBe('savings');
    expect(runDeterministicParser(parserInputFor(UNKNOWN_BANK_TEXT))).toBeNull();
  });

  it('does not blame the configuration when a configured provider failed', async () => {
    // The mock is configured but has no answer registered, so it refuses —
    // just as a real provider that is rate limited would. The old message said
    // "no AI provider is configured" here and sent people to the wrong file.
    const response = await upload(UNKNOWN_BANK_TEXT).expect(400);
    const message: string = response.body.error.message;
    expect(message).toMatch(/No built-in parser covers this statement/);
    expect(message).not.toMatch(/no AI provider is configured/);
    expect(message).not.toMatch(/LLM_PROVIDER/);
  });

  it('falls back to the model, and stores what it returned', async () => {
    setMockResponse('parsed-statement', LLM_ANSWER);

    const response = await upload(UNKNOWN_BANK_TEXT).expect(201);
    const result = response.body.data;

    expect(result.statement.parser).toBe('llm');
    expect(result.statement.status).toBe('parsed');
    expect(result.statement.reconciliation.ok).toBe(true);
    expect(result.transactions).toHaveLength(3);
    expect(result.warnings.map((warning: { code: string }) => warning.code)).toContain('llm_used');

    // The usage the provider reported is kept on the statement.
    expect(result.statement.llm).toMatchObject({ provider: 'mock', modelId: 'mock-fixture' });
    expect(result.statement.llm.inputTokens).toBeGreaterThan(0);

    // And the rules still categorise what the model returned.
    const rows: Array<{ merchant: string; category: string }> = result.transactions;
    expect(rows.find((txn) => txn.merchant === 'Blinkit')?.category).toBe('Groceries');
    expect(rows.find((txn) => /ATM/i.test(txn.merchant))?.category).toBe('Cash & transfers');

    // It was stored, not just returned.
    const library = await testApp.http.get('/api/statements').expect(200);
    expect(library.body.data.statements).toHaveLength(1);
  });

  it('marks needs_review rather than storing a model answer that does not add up', async () => {
    setMockResponse('parsed-statement', {
      ...LLM_ANSWER,
      savings: { ...LLM_ANSWER.savings, closingBalanceMinor: 9_999_999 },
    });

    const response = await upload(UNKNOWN_BANK_TEXT).expect(201);
    const statement = response.body.data.statement;
    expect(statement.status).toBe('needs_review');
    expect(statement.reconciliation.ok).toBe(false);
    expect(statement.reconciliation.message).toMatch(/difference/);
  });

  it('refuses, rather than saves, when the model returns something that is not a statement', async () => {
    setMockResponse('parsed-statement', { sorry: 'I could not read that' });
    const response = await upload(UNKNOWN_BANK_TEXT).expect(400);
    expect(response.body.error.message).toMatch(/No built-in parser covers this statement/);
    const library = await testApp.http.get('/api/statements').expect(200);
    expect(library.body.data.statements).toHaveLength(0);
  });
});

describe('a bank a deterministic parser does cover', () => {
  it('never reaches the model, even when one is available', async () => {
    // No answer registered: the mock throws if it is called at all.
    const response = await upload(fixtureText(FIXTURE_NAMES.card)).expect(201);
    const result = response.body.data;

    expect(result.statement.parser).toBe('deterministic:axis-supermoney-card');
    expect(result.statement.llm).toBeNull();
    expect(result.statement.reconciliation.ok).toBe(true);
    expect(result.warnings.map((warning: { code: string }) => warning.code)).not.toContain(
      'llm_used',
    );
  });
});
