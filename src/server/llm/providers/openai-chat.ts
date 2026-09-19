import { parseJsonResponse } from '../json';
import {
  DEFAULT_MAX_TOKENS,
  LlmRateLimitError,
  LlmRequestTooLargeError,
  LlmResponseError,
  type ExtractJsonArgs,
  type LlmUsage,
  type ProviderId,
} from '../provider';

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
 * How long we are willing to sit waiting out a rate limit, and how many times.
 *
 * One statement costs more than a minute of a free-tier token budget — a real
 * 4-page statement measured 4,381 tokens in and 4,186 out against Groq's
 * 8,000/minute — so the second call of an upload is *expected* to be refused,
 * and waiting is the normal path rather than an error path. The ceiling keeps
 * the whole upload inside the route's 60s budget.
 */
const MAX_RATE_LIMIT_ATTEMPTS = 3;
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

export async function chatCompletionJson<T>(
  options: ChatCallOptions,
  args: ExtractJsonArgs,
): Promise<{ data: T; usage: LlmUsage }> {
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: 0,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  let lastWaitMs = 0;

  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
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
      if (attempt === MAX_RATE_LIMIT_ATTEMPTS) break;
      await sleep(lastWaitMs + 500);
      continue;
    }

    if (response.status === 413) {
      // Too large for the account's per-minute budget. Waiting cannot help.
      throw new LlmRequestTooLargeError(options.providerId);
    }

    if (!response.ok) {
      // The status and the provider, never the body: a 400 echoes the prompt.
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
