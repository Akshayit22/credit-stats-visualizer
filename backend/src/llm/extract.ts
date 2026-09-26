import type { LlmUsage } from '@cred-stats/shared';
import type { z } from 'zod';
import { retryPrompt, withSchema } from './prompts.js';
import { LlmResponseError, type ExtractJsonArgs, type LlmProvider } from './provider.js';

export interface ValidatedExtraction<T> {
  data: T;
  usage: LlmUsage;
  /** 1 on a first-try success, 2 when the retry was needed. */
  attempts: number;
}

/**
 * Asks a provider for JSON and holds it to the schema.
 *
 * On a validation failure it retries **once**, appending the validation error
 * to the prompt so the model sees what it got wrong. A second failure throws:
 * the pipeline then reports the statement as unread rather than storing
 * something that did not typecheck.
 *
 * The validation error handed back to the model is field paths and issue
 * codes only — an issue's received value would be statement text.
 */
export async function extractValidated<S extends z.ZodType>(
  provider: LlmProvider,
  schema: S,
  args: ExtractJsonArgs,
): Promise<ValidatedExtraction<z.output<S>>> {
  let inputTokens = 0;
  let outputTokens = 0;
  // The schema goes in the prompt, not just in the argument. Providers vary in
  // whether they have a structured-output mode; every one of them can read.
  const baseUser = withSchema(args.user, args.jsonSchema);
  let user = baseUser;
  let lastError = '';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await provider.extractJson<unknown>({ ...args, user });
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;

    const parsed = schema.safeParse(result.data);
    if (parsed.success) {
      return {
        data: parsed.data,
        usage: { provider: provider.id, modelId: provider.modelId, inputTokens, outputTokens },
        attempts: attempt,
      };
    }

    lastError = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      .join('; ');
    user = retryPrompt(baseUser, lastError);
  }

  throw new LlmResponseError(
    provider.id,
    `The model's output did not match the schema after a retry (${lastError}).`,
  );
}
