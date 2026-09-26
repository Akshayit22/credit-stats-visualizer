import { parseJsonResponse } from '../json.js';
import {
  DEFAULT_MAX_TOKENS,
  LlmRateLimitError,
  LlmRequestTooLargeError,
  LlmResponseError,
  MAX_OUTPUT_TOKENS,
  type ExtractJsonArgs,
  type LlmUsage,
  type ProviderId,
} from '../provider.js';

/**
 * The OpenAI chat-completions request shape, which Groq, xAI, OpenRouter,
 * Ollama, OpenAI itself and Azure OpenAI all speak. Three of our four providers
 * are this call with a different base URL and a different auth header, so it
 * lives here once.
 */

export interface ChatCallOptions {
  providerId: ProviderId;
  url: string;
  headers: Record<string, string>;
  model: string;
  /** Some deployments reject `response_format`; the caller decides. */
  jsonMode: boolean;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * How many times one call may be sent, and how long it may wait between tries.
 *
 * Two things earn a retry here and both are ordinary rather than exceptional.
 * A rate limit: one statement costs more than a minute of a free-tier token
 * budget — a real 4-page statement measured 4,381 tokens in and 4,186 out
 * against Groq's 8,000/minute — so the second call of an upload is *expected*
 * to be refused. And a truncated answer, where the only thing wrong is that we
 * did not ask for enough room. The wait ceiling keeps the whole upload inside
 * the route's own budget.
 */
const MAX_ATTEMPTS = 3;
const MAX_RATE_LIMIT_WAIT_MS = 20_000;

/**
 * How long the provider asked us to wait.
 *
 * `retry-after` is the standard header and is preferred. Groq does not always
 * send it, but its 429 body states the delay to the centisecond ("Please try
 * again in 9.66s") — so the body is read for that one number and nothing else.
 * It never reaches a log: a 400 body echoes the prompt, and no caller should
 * learn to trust these bodies.
 */
function retryAfterMs(response: Response, body: string): number | null {
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  const stated = /try again in ([\d.]+)\s*s/i.exec(body);
  const seconds = stated ? Number(stated[1]) : Number.NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether a 400 means "you cut me off", not "your request was wrong".
 *
 * A model that runs out of `max_tokens` mid-object leaves JSON that does not
 * parse, and a provider in JSON mode rejects that as `json_validate_failed`.
 * It is worth one more try with room to finish — no estimate is right for every
 * bank, and being cut off is not a reason to lose the upload.
 *
 * Only the error code is read. The rest of that body carries the partial
 * generation, which is statement text, and never leaves this function.
 */
function isTruncation(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    const code: unknown = (parsed as { error?: { code?: unknown } }).error?.code;
    return code === 'json_validate_failed';
  } catch {
    return false;
  }
}

export async function chatCompletionJson<T>(
  options: ChatCallOptions,
  args: ExtractJsonArgs,
): Promise<{ data: T; usage: LlmUsage }> {
  const requested = args.maxTokens ?? DEFAULT_MAX_TOKENS;
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: requested,
    temperature: 0,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  let lastWaitMs = 0;
  let grewOnce = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
      // A long statement plus a model that thinks about it needs more than the
      // platform default, and less than forever.
      signal: AbortSignal.timeout(90_000),
    });

    if (response.status === 429) {
      // The only body we read on a failure, and only for the delay in it.
      const stated = retryAfterMs(response, await response.text());
      lastWaitMs = Math.min(stated ?? 10_000, MAX_RATE_LIMIT_WAIT_MS);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(lastWaitMs + 500);
      continue;
    }

    if (response.status === 413) {
      // Too large for the account's per-minute budget. Waiting cannot help.
      throw new LlmRequestTooLargeError(options.providerId);
    }

    if (!response.ok) {
      // The body is read here and goes no further: a 400 echoes the prompt back.
      const failure = await response.text();
      const worthGrowing =
        response.status === 400 &&
        !grewOnce &&
        attempt < MAX_ATTEMPTS &&
        requested < MAX_OUTPUT_TOKENS &&
        isTruncation(failure);
      if (worthGrowing) {
        grewOnce = true;
        body.max_tokens = MAX_OUTPUT_TOKENS;
        continue;
      }
      throw new LlmResponseError(
        options.providerId,
        `The provider answered ${response.status} ${response.statusText}.`,
      );
    }

    const payload = (await response.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new LlmResponseError(options.providerId, 'The provider returned an empty message.');
    }

    return {
      data: parseJsonResponse(options.providerId, content) as T,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      },
    };
  }

  throw new LlmRateLimitError(options.providerId, lastWaitMs);
}
