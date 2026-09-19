/**
 * The AI provider seam.
 *
 * Every provider answers the same question — "here is a system prompt, a user
 * prompt and a JSON schema; give me JSON that fits" — and nothing above this
 * line knows which one is answering. Swapping providers is an env var.
 *
 * What a provider must never do: log a prompt, a response, or anything derived
 * from statement text. Providers report their id, their model id, token counts
 * and a duration, and that is the whole of what reaches a log line.
 */

export type ProviderId =
  | 'mock'
  | 'azure-foundry'
  | 'bedrock'
  | 'groq'
  | 'openai-compatible';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ExtractJsonArgs {
  system: string;
  user: string;
  /** The response must validate against this. */
  jsonSchema: object;
  maxTokens?: number;
  /** Names the shape being asked for, so a provider can label its request. */
  schemaName?: string;
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly modelId: string;
  extractJson<T>(args: ExtractJsonArgs): Promise<{ data: T; usage: LlmUsage }>;
}

/** Thrown when a provider is selected but its environment is incomplete. */
export class ProviderConfigError extends Error {
  readonly providerId: string;
  readonly missing: string[];

  constructor(providerId: string, missing: string[]) {
    super(
      `LLM_PROVIDER=${providerId} needs ${missing.join(', ')}. ` +
        `Set ${missing.length === 1 ? 'it' : 'them'} in .env.local — SETUP.md §3 says where each value comes from. ` +
        `Or set LLM_PROVIDER=mock to run without a model.`,
    );
    this.name = 'ProviderConfigError';
    this.providerId = providerId;
    this.missing = missing;
  }
}

/** Thrown when a provider answered, but not with usable JSON. */
export class LlmResponseError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string) {
    super(message);
    this.name = 'LlmResponseError';
    this.providerId = providerId;
  }
}

/**
 * Thrown when a provider refused because we are over its rate limit.
 *
 * Separate from LlmResponseError because it is the one failure that is worth
 * waiting out: nothing is wrong with the request, there is just no budget for
 * it this minute. `retryAfterMs` is what the provider itself said to wait.
 */
export class LlmRateLimitError extends Error {
  readonly providerId: string;
  readonly retryAfterMs: number;

  constructor(providerId: string, retryAfterMs: number) {
    super(
      `${providerId} is rate limited; it asked for ${Math.ceil(retryAfterMs / 1000)}s before the next request.`,
    );
    this.name = 'LlmRateLimitError';
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown when the request can never fit, however long we wait.
 *
 * Distinct from LlmRateLimitError because retrying is pointless: the provider
 * is not saying "not now", it is saying "not on this account". Groq answers
 * 413 for this, and the difference matters — one is a pause, the other needs a
 * bigger tier, a different provider, or a smaller request.
 */
export class LlmRequestTooLargeError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`${providerId} refused the request as too large for the account's limit.`);
    this.name = 'LlmRequestTooLargeError';
    this.providerId = providerId;
  }
}

export const DEFAULT_MAX_TOKENS = 8000;

/**
 * The most output we will ever ask for.
 *
 * Not a preference — 8,192 is a hard cap on real models (`groq/compound`
 * rejects anything above it outright), and providers count the *requested*
 * output against a per-minute budget whether or not it is used. Asking for
 * 16,000 "just in case", as this used to, made every sizeable statement a
 * permanent 413 on a free tier rather than a request that merely had to wait.
 */
export const MAX_OUTPUT_TOKENS = 8_192;

/**
 * How much output a statement of this size needs.
 *
 * The answer is the statement restated as JSON — one object per printed row —
 * so it tracks the input rather than being a constant. A measured 4-page
 * statement of 2,918 text tokens answered in 4,186, a ratio of 1.43; 1.6 is
 * that with room, because the two ways to be wrong are not equal. Too high
 * costs budget that may go unused and is recoverable by waiting; too low
 * truncates the JSON mid-object, which fails validation and burns the retry.
 */
export function estimateOutputTokens(text: string): number {
  const inputTokens = Math.ceil(text.length / 3.6);
  return Math.min(Math.max(2_000, Math.round(inputTokens * 1.6)), MAX_OUTPUT_TOKENS);
}

/**
 * Reads the environment and reports what is missing rather than throwing, so
 * the settings screen can show the state without breaking the page.
 */
export function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim().length === 0;
  });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new ProviderConfigError(process.env.LLM_PROVIDER ?? 'unknown', [name]);
  }
  return value.trim();
}
