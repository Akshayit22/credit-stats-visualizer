import { findPiiLeaks } from '@cred-stats/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parsedStatementSchema } from '../../src/domain/schemas.js';
import { Environment } from '../../src/services/environment.service.js';
import { extractValidated } from '../../src/llm/extract.js';
import { extractJsonBody, stripFences } from '../../src/llm/json.js';
import { CATEGORISE_SYSTEM, EXTRACT_SYSTEM, extractUserPrompt } from '../../src/llm/prompts.js';
import {
  LlmRateLimitError,
  LlmRequestTooLargeError,
  MAX_OUTPUT_TOKENS,
  ProviderConfigError,
  estimateOutputTokens,
  type ExtractJsonArgs,
  type LlmProvider,
} from '../../src/llm/provider.js';
import {
  buildProvider,
  configuredModelId,
  missingSettings,
} from '../../src/llm/provider-factory.js';
import { clearMockResponses, setMockResponse } from '../../src/llm/providers/mock.js';
import { FIXTURE_NAMES, fixtureText } from '../helpers/fixtures.js';

/** A validated environment with just the given variables set. */
function envWith(vars: Record<string, string>) {
  return Environment.parse({ MONGODB_URI: 'mongodb://unused', ...vars });
}

const GROQ = { LLM_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test', GROQ_MODEL: 'openai/gpt-oss-120b' };

beforeEach(() => {
  clearMockResponses();
});

afterEach(() => {
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
    const env = envWith({});
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(missingSettings(env)).toEqual([]);
    expect(buildProvider(env).id).toBe('mock');
  });

  it('names exactly what is missing rather than failing at the vendor', () => {
    const env = envWith({
      LLM_PROVIDER: 'azure-foundry',
      AZURE_AI_ENDPOINT: 'https://example.openai.azure.com',
    });

    expect(missingSettings(env)).toEqual(['AZURE_AI_API_KEY', 'AZURE_AI_DEPLOYMENT']);

    try {
      buildProvider(env);
      throw new Error('expected a ProviderConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConfigError);
      expect((error as ProviderConfigError).message).toContain('AZURE_AI_API_KEY');
      expect((error as ProviderConfigError).message).toContain('docs/setup.md');
      // The message must never carry the value of a key that IS set.
      expect((error as ProviderConfigError).message).not.toContain('example.openai.azure.com');
    }
  });

  it('treats a blank value in .env as missing', () => {
    expect(missingSettings(envWith({ LLM_PROVIDER: 'groq', GROQ_API_KEY: '   ' }))).toEqual([
      'GROQ_API_KEY',
    ]);
  });

  it('builds each provider once its environment is complete', () => {
    const groq = envWith(GROQ);
    expect(buildProvider(groq).id).toBe('groq');
    expect(configuredModelId(groq)).toBe('openai/gpt-oss-120b');

    const compatible = envWith({
      LLM_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'https://api.x.ai/v1',
      OPENAI_COMPATIBLE_API_KEY: 'xai-test',
      OPENAI_COMPATIBLE_MODEL: 'grok-4',
    });
    expect(buildProvider(compatible).id).toBe('openai-compatible');
    expect(configuredModelId(compatible)).toBe('grok-4');
  });

  it('refuses an unknown provider name at boot rather than guessing', () => {
    expect(() => envWith({ LLM_PROVIDER: 'some-provider-that-does-not-exist' })).toThrow(
      /LLM_PROVIDER/,
    );
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
      jsonSchema: {
        type: 'object',
        required: ['answer'],
        properties: { answer: { type: 'integer' } },
      },
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
    const provider = buildProvider(envWith({}));

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
    const provider = buildProvider(envWith({}));
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

describe('being rate limited', () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  function groq(): LlmProvider {
    return buildProvider(envWith(GROQ));
  }

  const answer = () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 4381, completion_tokens: 4186 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const refusal = (headers: Record<string, string> = {}) =>
    new Response(
      JSON.stringify({
        error: {
          message:
            'Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): ' +
            'Limit 8000, Used 4859, Requested 4429. Please try again in 0.02s.',
          code: 'rate_limit_exceeded',
        },
      }),
      { status: 429, headers },
    );

  it('waits the delay the provider stated and tries again', async () => {
    // One statement costs more than a minute of a free tier's budget, so the
    // second call of an upload being refused is the normal path, not an error.
    const calls: number[] = [];
    globalThis.fetch = (() => {
      calls.push(Date.now());
      return Promise.resolve(calls.length === 1 ? refusal() : answer());
    }) as typeof fetch;

    const result = await groq().extractJson({ system: 's', user: 'u', jsonSchema: {} });
    expect(result.data).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('prefers the retry-after header over the body', async () => {
    let seen = 0;
    globalThis.fetch = (() => {
      seen += 1;
      return Promise.resolve(seen === 1 ? refusal({ 'retry-after': '0' }) : answer());
    }) as typeof fetch;

    await expect(
      groq().extractJson({ system: 's', user: 'u', jsonSchema: {} }),
    ).resolves.toMatchObject({ data: { ok: true } });
    expect(seen).toBe(2);
  });

  it('gives up as a rate limit, not as a generic failure', async () => {
    // The distinction is the whole point: "wait a minute" and "your config is
    // wrong" send someone to entirely different places.
    globalThis.fetch = (() => Promise.resolve(refusal())) as typeof fetch;

    const error = await groq()
      .extractJson({ system: 's', user: 'u', jsonSchema: {} })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmRateLimitError);
    expect((error as LlmRateLimitError).providerId).toBe('groq');
  });

  it('treats "too large" as permanent, not as something to wait out', async () => {
    // Requested = prompt + max_tokens, and a provider says 413 when that can
    // never fit the account's budget. Retrying is pointless; saying "try again
    // shortly" would send someone back for an answer that will not change.
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(new Response('{}', { status: 413, statusText: 'Payload Too Large' }));
    }) as typeof fetch;

    const error = await groq()
      .extractJson({ system: 's', user: 'u', jsonSchema: {} })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmRequestTooLargeError);
    expect(calls).toBe(1);
  });

  it('never lets a failure body escape, however tempting it looks', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('{"error":{"message":"your prompt said UPI/AKSHAY/pay"}}', {
          status: 400,
          statusText: 'Bad Request',
        }),
      )) as typeof fetch;

    const error = await groq()
      .extractJson({ system: 's', user: 'u', jsonSchema: {} })
      .catch((caught: unknown) => caught);

    expect((error as Error).message).toBe('The provider answered 400 Bad Request.');
    expect((error as Error).message).not.toContain('AKSHAY');
  });
});

describe('sizing the answer', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => `05 Oct 25\tSOMETHING ${i}\t1,234.56\t9,999.00 CR`).join(
      '\n',
    );

  it('sizes from the rows, not the character count', () => {
    // The two are not interchangeable. IDFC spends 2,879 text tokens on 21
    // rows because it wraps a description over three printed lines; slice
    // spends 1,063 on 42 because it does not. Sizing slice from its length
    // cut the model off mid-object and the provider rejected the answer.
    const verbose = `${'filler text that carries no amount\n'.repeat(400)}${rows(5)}`;
    const terse = rows(40);
    expect(verbose.length).toBeGreaterThan(terse.length);
    expect(estimateOutputTokens(terse)).toBeGreaterThan(estimateOutputTokens(verbose));
  });

  it('grows with the number of rows', () => {
    expect(estimateOutputTokens(rows(30))).toBeGreaterThan(estimateOutputTokens(rows(5)));
  });

  it('never exceeds what real models accept', () => {
    // groq/compound rejects any max_tokens above 8,192 outright, and every
    // provider charges the *requested* output against the per-minute budget
    // whether the model uses it or not. The old flat 16,000 made a sizeable
    // statement a permanent 413 rather than a request that had to wait.
    expect(estimateOutputTokens(rows(500))).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(8_192);
  });

  it('keeps a floor, so a one-page statement still has room to answer', () => {
    expect(estimateOutputTokens('')).toBe(2_000);
  });
});

describe('an answer cut off mid-object', () => {
  const ORIGINAL_FETCH = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  const truncated = () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Failed to validate JSON. See 'failed_generation' for more details.",
          code: 'json_validate_failed',
          failed_generation: '{"transactions":[{"descriptionRaw":"UPI/AKSHAY/pay"',
        },
      }),
      { status: 400, statusText: 'Bad Request' },
    );

  function groqWith(maxTokens: number) {
    return buildProvider(envWith(GROQ)).extractJson({
      system: 's',
      user: 'u',
      jsonSchema: {},
      maxTokens,
    });
  }

  it('asks again with room to finish rather than losing the upload', async () => {
    // No estimate is right for every bank, and being cut off is not the
    // user's mistake. The second ask uses the ceiling.
    const sent: number[] = [];
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      sent.push((JSON.parse(String(init.body)) as { max_tokens: number }).max_tokens);
      return Promise.resolve(
        sent.length === 1
          ? truncated()
          : new Response(
              JSON.stringify({
                choices: [{ message: { content: '{"ok":true}' } }],
                usage: { prompt_tokens: 10, completion_tokens: 5 },
              }),
              { status: 200 },
            ),
      );
    }) as unknown as typeof fetch;

    await expect(groqWith(2_000)).resolves.toMatchObject({ data: { ok: true } });
    expect(sent).toEqual([2_000, MAX_OUTPUT_TOKENS]);
  });

  it('grows once, not forever', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(truncated());
    }) as typeof fetch;

    await expect(groqWith(2_000)).rejects.toThrow(/400 Bad Request/);
    expect(calls).toBe(2);
  });

  it('keeps the partial generation out of the error, since it is statement text', async () => {
    globalThis.fetch = (() => Promise.resolve(truncated())) as typeof fetch;
    const error = await groqWith(MAX_OUTPUT_TOKENS).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe('The provider answered 400 Bad Request.');
    expect((error as Error).message).not.toContain('AKSHAY');
  });
});
