import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJsonBody, stripFences } from '@/server/llm/json';
import {
  configuredModelId,
  configuredProviderId,
  getLlmProvider,
  providerMissingEnv,
  resetLlmProvider,
} from '@/server/llm/factory';
import { ProviderConfigError, type ExtractJsonArgs, type LlmProvider } from '@/server/llm/provider';
import { clearMockResponses, setMockResponse } from '@/server/llm/providers/mock';
import { extractValidated } from '@/server/llm';
import { parsedStatementSchema } from '@/server/domain/schemas';
import { CATEGORISE_SYSTEM, EXTRACT_SYSTEM, extractUserPrompt } from '@/server/llm/prompts';
import { findPiiLeaks } from '@/shared/redact';
import { FIXTURE_NAMES, fixtureText } from './fixtures';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetLlmProvider();
  clearMockResponses();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetLlmProvider();
  clearMockResponses();
});

describe('reading JSON out of a model', () => {
  it('strips markdown fences', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });

  it('finds the JSON inside prose on either side', () => {
    expect(extractJsonBody('Here you go:\n{"a":1}\nLet me know if you need more!')).toBe('{"a":1}');
    expect(extractJsonBody('Sure! ```json\n[{"a":1}]\n``` Done.')).toBe('[{"a":1}]');
  });

  it('is not fooled by a brace inside a merchant name', () => {
    const raw = 'Result: {"merchant":"Curly } Braces Cafe","amountMinor":100} — hope that helps';
    expect(JSON.parse(extractJsonBody(raw))).toEqual({
      merchant: 'Curly } Braces Cafe',
      amountMinor: 100,
    });
  });

  it('is not fooled by an escaped quote', () => {
    const raw = '{"merchant":"O\\"Brien\\u2019s","amountMinor":1}';
    expect(JSON.parse(extractJsonBody(raw))).toMatchObject({ amountMinor: 1 });
  });
});

describe('the provider factory', () => {
  it('defaults to the mock provider, which needs no configuration', () => {
    delete process.env.LLM_PROVIDER;
    expect(configuredProviderId()).toBe('mock');
    expect(providerMissingEnv()).toEqual([]);
    expect(getLlmProvider().id).toBe('mock');
  });

  it('names exactly what is missing rather than failing at the vendor', () => {
    process.env.LLM_PROVIDER = 'azure-foundry';
    process.env.AZURE_AI_ENDPOINT = 'https://example.openai.azure.com';
    delete process.env.AZURE_AI_API_KEY;
    delete process.env.AZURE_AI_DEPLOYMENT;
    delete process.env.AZURE_AI_API_VERSION;

    expect(providerMissingEnv()).toEqual([
      'AZURE_AI_API_KEY',
      'AZURE_AI_DEPLOYMENT',
      'AZURE_AI_API_VERSION',
    ]);

    try {
      getLlmProvider();
      throw new Error('expected a ProviderConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConfigError);
      expect((error as ProviderConfigError).message).toContain('AZURE_AI_API_KEY');
      expect((error as ProviderConfigError).message).toContain('SETUP.md');
      // The message must never carry the value of a key that IS set.
      expect((error as ProviderConfigError).message).not.toContain('example.openai.azure.com');
    }
  });

  it('builds each provider once its environment is complete', () => {
    process.env.LLM_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'gsk_test';
    process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
    expect(getLlmProvider().id).toBe('groq');
    expect(configuredModelId()).toBe('openai/gpt-oss-120b');

    resetLlmProvider();
    process.env.LLM_PROVIDER = 'openai-compatible';
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://api.x.ai/v1';
    process.env.OPENAI_COMPATIBLE_API_KEY = 'xai-test';
    process.env.OPENAI_COMPATIBLE_MODEL = 'grok-4';
    expect(getLlmProvider().id).toBe('openai-compatible');

    resetLlmProvider();
    process.env.LLM_PROVIDER = 'bedrock';
    process.env.BEDROCK_MODEL_ID = 'anthropic.claude-sonnet-5';
    expect(getLlmProvider().id).toBe('bedrock');
  });

  it('falls back to mock rather than crashing on an unknown provider name', () => {
    process.env.LLM_PROVIDER = 'some-provider-that-does-not-exist';
    expect(configuredProviderId()).toBe('mock');
  });
});

describe('schema-validated extraction', () => {
  const schema = z.object({ answer: z.number().int() });

  function countingProvider(replies: unknown[]): LlmProvider & { calls: ExtractJsonArgs[] } {
    const calls: ExtractJsonArgs[] = [];
    return {
      id: 'mock',
      modelId: 'test',
      calls,
      extractJson<T>(args: ExtractJsonArgs) {
        calls.push(args);
        const reply = replies[calls.length - 1];
        return Promise.resolve({
          data: reply as T,
          usage: { inputTokens: 10, outputTokens: 5 },
        });
      },
    };
  }

  it('returns the parsed value and the token counts on a first-try success', async () => {
    const provider = countingProvider([{ answer: 42 }]);
    const result = await extractValidated(provider, schema, {
      system: 's',
      user: 'u',
      jsonSchema: {},
    });
    expect(result.data).toEqual({ answer: 42 });
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(provider.calls).toHaveLength(1);
  });

  it('puts the schema in the prompt, because providers vary in reading it', async () => {
    const provider = countingProvider([{ answer: 42 }]);
    await extractValidated(provider, schema, {
      system: 's',
      user: 'extract this',
      jsonSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'integer' } } },
    });
    // Every provider takes a jsonSchema and, for a while, every provider
    // ignored it — the model was told the rules and never the field names.
    const sent = provider.calls[0]?.user ?? '';
    expect(sent).toContain('extract this');
    expect(sent).toContain('"answer"');
    expect(sent).toMatch(/schema exactly/i);
  });

  it('retries exactly once, showing the model its own validation error', async () => {
    const provider = countingProvider([{ answer: 'forty-two' }, { answer: 42 }]);
    const result = await extractValidated(provider, schema, {
      system: 's',
      user: 'the original prompt',
      jsonSchema: {},
    });

    expect(result.data).toEqual({ answer: 42 });
    expect(provider.calls).toHaveLength(2);
    // Tokens from both attempts are counted, so cost is not under-reported.
    expect(result.usage.inputTokens).toBe(20);

    const retry = provider.calls[1]?.user ?? '';
    expect(retry).toContain('the original prompt');
    expect(retry).toContain('did not match the required schema');
    expect(retry).toContain('answer');
  });

  it('gives up after the second failure rather than storing bad data', async () => {
    const provider = countingProvider([{ answer: 'no' }, { answer: 'still no' }]);
    await expect(
      extractValidated(provider, schema, { system: 's', user: 'u', jsonSchema: {} }),
    ).rejects.toThrow(/did not match the schema after a retry/);
    expect(provider.calls).toHaveLength(2);
  });
});

describe('what the schema accepts from a real model', () => {
  const minimal = {
    accountType: 'savings',
    periodStart: '2026-04-01',
    periodEnd: '2026-04-30',
    account: { type: 'savings', issuer: 'Some Bank', last4: '4417' },
    savings: {
      openingBalanceMinor: 1_250_000,
      totalCreditsMinor: 4_000_000,
      totalDebitsMinor: 1_825_000,
      interestEarnedMinor: 0,
      closingBalanceMinor: 3_425_000,
    },
    transactions: [
      {
        date: '2026-04-05',
        descriptionRaw: 'UPI/BLINKIT/blinkit@ybl',
        amountMinor: 125_000,
        direction: 'debit',
        mode: 'upi',
      },
    ],
  };

  it('fills in the fields a model simply leaves out', () => {
    const parsed = parsedStatementSchema.parse(minimal);
    expect(parsed.transactions[0]?.merchant).toBe('');
    expect(parsed.transactions[0]?.isFee).toBe(false);
    expect(parsed.account.productName).toBe('');
  });

  it('treats an explicit null the same as leaving the field out', () => {
    // gpt-oss-120b answers `"counterparty": null` rather than omitting the
    // key. That used to fail validation, burn the one retry, and throw away an
    // otherwise perfect extraction.
    const withNulls = {
      ...minimal,
      account: { ...minimal.account, productName: null, maskedNumber: null },
      transactions: [
        {
          ...minimal.transactions[0],
          counterparty: null,
          merchant: null,
          isFee: null,
          isInterest: null,
          isPayment: null,
        },
      ],
    };
    const parsed = parsedStatementSchema.parse(withNulls);
    expect(parsed.transactions[0]?.counterparty).toBe('');
    expect(parsed.transactions[0]?.merchant).toBe('');
    expect(parsed.transactions[0]?.isPayment).toBe(false);
    expect(parsed.account.maskedNumber).toBe('');
  });
});

describe('the mock provider', () => {
  it('answers per schema name', async () => {
    setMockResponse('parsed-statement', { kind: 'statement' });
    setMockResponse('merchant-categories', { kind: 'categories' });
    const provider = getLlmProvider();

    const statement = await provider.extractJson({
      system: '',
      user: '',
      jsonSchema: {},
      schemaName: 'parsed-statement',
    });
    expect(statement.data).toEqual({ kind: 'statement' });

    const categories = await provider.extractJson({
      system: '',
      user: '',
      jsonSchema: {},
      schemaName: 'merchant-categories',
    });
    expect(categories.data).toEqual({ kind: 'categories' });
  });

  it('refuses rather than inventing figures when no fixture is registered', async () => {
    const provider = getLlmProvider();
    await expect(
      provider.extractJson({ system: '', user: '', jsonSchema: {}, schemaName: 'unknown' }),
    ).rejects.toThrow(/no fixture/);
  });
});

describe('what actually reaches a provider', () => {
  it('carries no identifier, in the prompt or the instructions', () => {
    const prompt = extractUserPrompt(
      // The pipeline redacts before this point; this asserts the composed
      // prompt adds nothing back.
      fixtureText(FIXTURE_NAMES.sliceJul).replace(/\b\d{9,}\b/g, '[ref]'),
      { issuer: 'slice small finance bank', accountType: 'savings' },
    );

    expect(findPiiLeaks(prompt)).toEqual([]);
    expect(prompt).not.toMatch(/AKSHAY|TELAN|LUMAN|PUSHPANJALI|VADAPALANI/i);
    expect(prompt).not.toMatch(/\b\d{9,}\b/);
  });

  it('tells the model the things that actually go wrong', () => {
    // Paise, not rupees — the single most expensive mistake it could make.
    expect(EXTRACT_SYSTEM).toMatch(/INTEGER NUMBER OF PAISE/);
    // Day-first dates: 05/07/2026 is July, not May.
    expect(EXTRACT_SYSTEM).toMatch(/day first/i);
    // The schedule-of-charges trap that page 2 of the Axis statement is.
    expect(EXTRACT_SYSTEM).toMatch(/schedule of/i);
    expect(EXTRACT_SYSTEM).toMatch(/NOT transactions/);
    // And that the mask tokens are not puzzles to solve.
    expect(EXTRACT_SYSTEM).toMatch(/never try to reconstruct/);
  });

  it('constrains categorisation to our own taxonomy', () => {
    expect(CATEGORISE_SYSTEM).toContain('Uncategorised');
    expect(CATEGORISE_SYSTEM).toContain('Cash & transfers');
    expect(CATEGORISE_SYSTEM).toMatch(/only JSON/);
  });
});
