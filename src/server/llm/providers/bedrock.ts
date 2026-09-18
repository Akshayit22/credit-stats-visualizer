import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { parseJsonResponse } from '../json';
import {
  DEFAULT_MAX_TOKENS,
  LlmResponseError,
  type ExtractJsonArgs,
  type LlmProvider,
  type LlmUsage,
} from '../provider';

/**
 * Amazon Bedrock through `ConverseCommand`, which gives one request shape
 * across every model family Bedrock hosts — so switching `BEDROCK_MODEL_ID`
 * from an Anthropic model to a Llama or Mistral one needs no code change.
 *
 * Credentials come from the standard AWS chain. Note the trap called out in
 * SETUP.md: `AWS_ACCESS_KEY_ID=local` from the DynamoDB Local section is in the
 * same chain, so a local Bedrock run wants a named profile or real keys.
 */
export function bedrockProvider(modelId: string, region: string): LlmProvider {
  const client = new BedrockRuntimeClient({ region });

  return {
    id: 'bedrock',
    modelId,
    async extractJson<T>(args: ExtractJsonArgs): Promise<{ data: T; usage: LlmUsage }> {
      const response = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: args.system }],
          messages: [{ role: 'user', content: [{ text: args.user }] }],
          inferenceConfig: {
            maxTokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
            temperature: 0,
          },
        }),
      );

      const blocks: ContentBlock[] = response.output?.message?.content ?? [];
      const text = blocks
        .map((block) => ('text' in block ? block.text : undefined))
        .filter((value): value is string => typeof value === 'string')
        .join('');

      if (text.trim().length === 0) {
        throw new LlmResponseError('bedrock', 'Bedrock returned an empty message.');
      }

      return {
        data: parseJsonResponse('bedrock', text) as T,
        usage: {
          inputTokens: response.usage?.inputTokens ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
        },
      };
    },
  };
}
