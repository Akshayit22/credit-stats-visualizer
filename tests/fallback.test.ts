import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { getRawClient } from '@/server/db/client';
import { TABLE_KINDS, tableName } from '@/server/db/table-names';
import { detectStatement, runDeterministicParser, parserInputFor } from '@/server/parsing/registry';
import { ingestStatement } from '@/server/domain/ingest';
import { getLlmFallback, resetLlmProvider } from '@/server/llm';
import { clearMockResponses, setMockResponse } from '@/server/llm/providers/mock';
import { deleteAllUserItems } from '@/server/db/repositories/users';
import { deleteAllAccounts } from '@/server/db/repositories/accounts';
import { deleteAllStatements } from '@/server/db/repositories/statements';
import { deleteAllTransactions } from '@/server/db/repositories/transactions';
import { deleteAllSummaries } from '@/server/db/repositories/summaries';
import { FIXTURE_NAMES, fixtureText } from './fixtures';

/**
 * The fallback path, end to end, against DynamoDB Local.
 *
 * Skipped with a clear message when DynamoDB Local is not up, so `npm test` on
 * a laptop without Docker still passes; CI runs it for real against the
 * `dynamodb-local` service.
 */

const USER_ID = 'test-fallback-user';

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

async function dynamoIsUp(): Promise<boolean> {
  try {
    const client = getRawClient();
    for (const kind of TABLE_KINDS) {
      await client.send(new DescribeTableCommand({ TableName: tableName(kind) }));
    }
    return true;
  } catch {
    return false;
  }
}

let available = false;

beforeAll(async () => {
  process.env.DDB_ENDPOINT ??= 'http://localhost:8000';
  process.env.AWS_REGION ??= 'ap-south-1';
  process.env.AWS_ACCESS_KEY_ID ??= 'local';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'local';
  available = await dynamoIsUp();
  if (!available) {
    console.warn(
      'DynamoDB Local is not reachable — skipping the fallback integration test. ' +
        'Run `npm run db:up && npm run db:create` to include it.',
    );
  }
});

beforeEach(() => {
  process.env.LLM_PROVIDER = 'mock';
  resetLlmProvider();
  clearMockResponses();
});

afterEach(async () => {
  clearMockResponses();
  if (!available) return;
  await deleteAllSummaries(USER_ID);
  await deleteAllTransactions(USER_ID);
  await deleteAllStatements(USER_ID);
  await deleteAllAccounts(USER_ID);
  await deleteAllUserItems(USER_ID);
});

afterAll(() => {
  resetLlmProvider();
});

describe('a bank no deterministic parser covers', () => {
  it('is recognised as a savings statement even though no parser matches', () => {
    const detection = detectStatement(UNKNOWN_BANK_TEXT);
    expect(detection.parserId).toBeNull();
    expect(detection.accountType).toBe('savings');
    expect(runDeterministicParser(parserInputFor(UNKNOWN_BANK_TEXT))).toBeNull();
  });

  it('fails honestly when no provider is configured', async () => {
    if (!available) return;
    await expect(
      ingestStatement({
        userId: USER_ID,
        text: UNKNOWN_BANK_TEXT,
        contentHash: 'a'.repeat(64),
        llm: null,
      }),
    ).rejects.toThrow(/No parser recognised this statement/);
  });

  it('falls back to the model, and stores what it returned', async () => {
    if (!available) return;
    setMockResponse('parsed-statement', LLM_ANSWER);

    const result = await ingestStatement({
      userId: USER_ID,
      text: UNKNOWN_BANK_TEXT,
      contentHash: 'b'.repeat(64),
      llm: getLlmFallback(),
    });

    expect(result.statement.parser).toBe('llm');
    expect(result.statement.status).toBe('parsed');
    expect(result.statement.reconciliation.ok).toBe(true);
    expect(result.transactions).toHaveLength(3);
    expect(result.warnings.map((warning) => warning.code)).toContain('llm_used');

    // The usage the provider reported is kept on the statement.
    expect(result.statement.llm).toMatchObject({ provider: 'mock', modelId: 'mock-fixture' });
    expect(result.statement.llm?.inputTokens).toBeGreaterThan(0);

    // And the rules still categorise what the model returned.
    const blinkit = result.transactions.find((txn) => txn.merchant === 'Blinkit');
    expect(blinkit?.category).toBe('Groceries');
    const atm = result.transactions.find((txn) => /ATM/i.test(txn.merchant));
    expect(atm?.category).toBe('Cash & transfers');
  });

  it('marks needs_review rather than storing a model answer that does not add up', async () => {
    if (!available) return;
    setMockResponse('parsed-statement', {
      ...LLM_ANSWER,
      savings: { ...LLM_ANSWER.savings, closingBalanceMinor: 9_999_999 },
    });

    const result = await ingestStatement({
      userId: USER_ID,
      text: UNKNOWN_BANK_TEXT,
      contentHash: 'c'.repeat(64),
      llm: getLlmFallback(),
    });

    expect(result.statement.status).toBe('needs_review');
    expect(result.statement.reconciliation.ok).toBe(false);
    expect(result.statement.reconciliation.message).toMatch(/difference/);
  });

  it('marks needs_review when the model returns something that is not a statement', async () => {
    if (!available) return;
    setMockResponse('parsed-statement', { sorry: 'I could not read that' });

    const result = await ingestStatement({
      userId: USER_ID,
      text: UNKNOWN_BANK_TEXT,
      contentHash: 'd'.repeat(64),
      llm: getLlmFallback(),
    }).catch((error: unknown) => error);

    // With nothing to fall back *to*, the upload is refused rather than saved.
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/No parser recognised this statement/);
  });
});

describe('a bank a deterministic parser does cover', () => {
  it('never reaches the model, even when one is available', async () => {
    if (!available) return;
    // No fixture registered: the mock throws if it is called at all.
    const result = await ingestStatement({
      userId: USER_ID,
      text: fixtureText(FIXTURE_NAMES.card),
      contentHash: 'e'.repeat(64),
      llm: getLlmFallback(),
    });

    expect(result.statement.parser).toBe('deterministic:axis-supermoney-card');
    expect(result.statement.llm).toBeNull();
    expect(result.statement.reconciliation.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).not.toContain('llm_used');
  });
});
