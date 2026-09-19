import { z } from 'zod';
import { redactForLlm } from '@/shared/redact';
import { logger } from '@/server/log';
import {
  MERCHANT_CATEGORIES_JSON_SCHEMA,
  PARSED_STATEMENT_JSON_SCHEMA,
  merchantCategoriesSchema,
  parsedStatementSchema,
} from '@/server/domain/schemas';
import type { LlmFallback } from '@/server/domain/ingest';
import type { ProviderInfo } from '@/client/screens/settings-screen';
import {
  configuredModelId,
  configuredProviderId,
  getLlmProvider,
  providerIsConfigured,
  providerMissingEnv,
} from './factory';
import {
  CATEGORISE_SYSTEM,
  EXTRACT_SYSTEM,
  categoriseUserPrompt,
  extractUserPrompt,
  retryPrompt,
  withSchema,
} from './prompts';
import {
  LlmResponseError,
  estimateOutputTokens,
  type ExtractJsonArgs,
  type LlmProvider,
} from './provider';

export { getLlmProvider, resetLlmProvider } from './factory';
export { setMockResponse, clearMockResponses } from './providers/mock';

/**
 * Asks a provider for JSON and holds it to the schema.
 *
 * On a validation failure it retries **once**, appending the validation error
 * to the prompt so the model sees what it got wrong. A second failure throws:
 * the pipeline then marks the statement `needs_review` rather than storing
 * something that did not typecheck.
 *
 * Logged: provider, model, schema, token counts, duration, whether a retry
 * happened. Never the prompt, never the response, never anything derived from
 * the statement.
 */
export async function extractValidated<S extends z.ZodTypeAny>(
  provider: LlmProvider,
  schema: S,
  args: ExtractJsonArgs,
): Promise<{
  data: z.infer<S>;
  usage: { provider: string; modelId: string; inputTokens: number; outputTokens: number };
}> {
  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  // The schema goes in the prompt, not just in the argument. Providers vary in
  // whether they have a structured-output mode; every one of them can read.
  const baseUser = withSchema(args.user, args.jsonSchema);
  let user = baseUser;
  let lastError = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await provider.extractJson<unknown>({ ...args, user });
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;

    const parsed = schema.safeParse(result.data);
    if (parsed.success) {
      logger.info('llm.extract', {
        provider: provider.id,
        modelId: provider.modelId,
        schema: args.schemaName ?? 'unnamed',
        inputTokens,
        outputTokens,
        retried: attempt > 0,
        durationMs: Date.now() - started,
      });
      return {
        data: parsed.data,
        usage: { provider: provider.id, modelId: provider.modelId, inputTokens, outputTokens },
      };
    }

    // Field paths only. An issue's `received` value would be statement text.
    lastError = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      .join('; ');
    user = retryPrompt(baseUser, lastError);
  }

  logger.warn('llm.extract.failed', {
    provider: provider.id,
    modelId: provider.modelId,
    schema: args.schemaName ?? 'unnamed',
    inputTokens,
    outputTokens,
    durationMs: Date.now() - started,
  });
  throw new LlmResponseError(
    provider.id,
    `The model's output did not match the schema after a retry (${lastError}).`,
  );
}

/**
 * The fallback the ingest pipeline reaches for. Null when the active provider
 * is not configured — the pipeline then reports honestly that no model was
 * available rather than failing in a way that looks like a parsing bug.
 */
export function getLlmFallback(): LlmFallback | null {
  if (!providerIsConfigured()) return null;

  let provider: LlmProvider;
  try {
    provider = getLlmProvider();
  } catch {
    return null;
  }

  return {
    async extract(text, hint) {
      // The one place statement text becomes a prompt, and the only place the
      // second redaction pass is applied.
      const safeText = redactForLlm(text);
      const result = await extractValidated(provider, parsedStatementSchema, {
        system: EXTRACT_SYSTEM,
        user: extractUserPrompt(safeText, hint),
        jsonSchema: PARSED_STATEMENT_JSON_SCHEMA,
        schemaName: 'parsed-statement',
        // Sized to this statement. A flat 16,000 made every sizeable upload a
        // permanent 413 on a free tier, because providers charge the requested
        // output against the budget whether the model uses it or not.
        maxTokens: estimateOutputTokens(safeText),
      });
      return { statement: result.data, usage: result.usage };
    },

    async categorise(merchants) {
      const result = await extractValidated(provider, merchantCategoriesSchema, {
        system: CATEGORISE_SYSTEM,
        user: categoriseUserPrompt(merchants.map((merchant) => redactForLlm(merchant))),
        jsonSchema: MERCHANT_CATEGORIES_JSON_SCHEMA,
        schemaName: 'merchant-categories',
        maxTokens: 2_000,
      });
      return { assignments: result.data.assignments, usage: result.usage };
    },
  };
}

/** What the settings screen shows. Read-only, and never the key itself. */
export function describeProvider(): ProviderInfo {
  const id = configuredProviderId();
  const missing = providerMissingEnv(id);
  return {
    id,
    modelId: configuredModelId(id),
    configured: missing.length === 0,
    missing,
    note:
      id === 'mock'
        ? 'No model is being called. The two built-in bank parsers handle the statements they cover; anything else is reported as unparsed rather than guessed.'
        : missing.length === 0
          ? 'Used only when no built-in parser covers a statement, when a parse does not reconcile, or to categorise a merchant no rule matched. Prompts are redacted first: no name, address, phone, email, customer id, account number or reference id reaches the provider.'
          : 'This provider is selected but not configured, so the app behaves as if no model were available. SETUP.md §3 says where each value comes from.',
  };
}
