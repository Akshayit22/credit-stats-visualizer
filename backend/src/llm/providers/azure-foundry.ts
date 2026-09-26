import { chatCompletionJson } from './openai-chat.js';
import type { ExtractJsonArgs, LlmProvider, LlmUsage } from '../provider.js';

/**
 * Azure AI Foundry / Azure OpenAI. The same chat-completions body as everyone
 * else, but the model is chosen by the **deployment name in the path** rather
 * than a `model` field, the API version is a query parameter, and the key goes
 * in an `api-key` header rather than a bearer token.
 */
export function azureFoundryProvider(
  endpoint: string,
  apiKey: string,
  deployment: string,
  apiVersion: string,
): LlmProvider {
  const url =
    `${endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deployment)}` +
    `/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  return {
    id: 'azure-foundry',
    modelId: deployment,
    extractJson<T>(args: ExtractJsonArgs): Promise<{ data: T; usage: LlmUsage }> {
      return chatCompletionJson<T>(
        {
          providerId: 'azure-foundry',
          url,
          headers: { 'api-key': apiKey },
          // Azure takes the model from the deployment in the path; sending one
          // as well is accepted but ignored, so send the deployment name.
          model: deployment,
          jsonMode: true,
        },
        args,
      );
    },
  };
}
