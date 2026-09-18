import { chatCompletionJson } from './openai-chat';
import type { ExtractJsonArgs, LlmProvider, LlmUsage } from '../provider';

/**
 * Anything that speaks `POST {base}/chat/completions` with a bearer token:
 * xAI Grok, OpenAI, OpenRouter, a local Ollama.
 */
export function openAiCompatibleProvider(
  modelId: string,
  baseUrl: string,
  apiKey: string,
): LlmProvider {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    id: 'openai-compatible',
    modelId,
    extractJson<T>(args: ExtractJsonArgs): Promise<{ data: T; usage: LlmUsage }> {
      return chatCompletionJson<T>(
        {
          providerId: 'openai-compatible',
          url,
          headers: { authorization: `Bearer ${apiKey}` },
          model: modelId,
          jsonMode: true,
        },
        args,
      );
    },
  };
}
