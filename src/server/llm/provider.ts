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

export const DEFAULT_MAX_TOKENS = 8000;

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
