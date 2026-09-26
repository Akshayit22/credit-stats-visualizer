/**
 * The AI provider seam.
 *
 * Every provider answers the same question — "here is a system prompt, a user
 * prompt and a JSON schema; give me JSON that fits" — and nothing above this
 * line knows which one is answering. Swapping providers is one env var,
 * `LLM_PROVIDER`.
 *
 * What a provider must never do: log a prompt, a response, or anything derived
 * from statement text. Providers report their id, their model id, token counts
 * and a duration, and that is the whole of what reaches a log line.
 */

export const PROVIDER_IDS = ['mock', 'groq', 'azure-foundry', 'openai-compatible'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

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
        `Set ${missing.length === 1 ? 'it' : 'them'} in backend/.env — docs/setup.md says where each value comes from. ` +
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

/** A printed line carrying a rupee amount — one transaction, near enough. */
const AMOUNT_LINE = /\d[\d,]*\.\d{2}/;

/**
 * How much output this statement needs.
 *
 * Counted from the rows, not the character count, because the answer is one
 * JSON object per printed row and banks are not alike in how much text a row
 * costs. Measured: IDFC spends 2,879 text tokens on 21 rows (it wraps a
 * description over three lines), slice spends 1,063 on 42 (it does not). A
 * length-proportional estimate sized slice's request from the wrong number and
 * the model was cut off mid-object, which the provider rejects outright.
 *
 * Over-estimating costs budget that may go unused and can be waited out;
 * under-estimating truncates the JSON and fails the request. So this rounds up,
 * and `chatCompletionJson` still retries at the ceiling if it was not enough.
 */
export function estimateOutputTokens(text: string): number {
  const rows = text.split('\n').filter((line) => AMOUNT_LINE.test(line)).length;
  const needed = 1_200 + rows * 260;
  return Math.min(Math.max(2_000, needed), MAX_OUTPUT_TOKENS);
}
