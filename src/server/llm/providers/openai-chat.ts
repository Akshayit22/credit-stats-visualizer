import { parseJsonResponse } from '../json';
import {
  DEFAULT_MAX_TOKENS,
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

  const response = await fetch(options.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
    // A long statement plus a model that thinks about it needs more than the
    // platform default, and less than forever.
    signal: AbortSignal.timeout(90_000),
  });

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
