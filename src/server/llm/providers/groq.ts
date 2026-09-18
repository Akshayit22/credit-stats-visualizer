import { chatCompletionJson } from './openai-chat';
import type { ExtractJsonArgs, LlmProvider, LlmUsage } from '../provider';

/** Groq — OpenAI-compatible, fixed base URL. */
export function groqProvider(modelId: string, apiKey: string): LlmProvider {
  return {
    id: 'groq',
    modelId,
    extractJson<T>(args: ExtractJsonArgs): Promise<{ data: T; usage: LlmUsage }> {
      return chatCompletionJson<T>(
        {
          providerId: 'groq',
          url: 'https://api.groq.com/openai/v1/chat/completions',
          headers: { authorization: `Bearer ${apiKey}` },
          model: modelId,
          jsonMode: true,
        },
        args,
      );
    },
  };
}
