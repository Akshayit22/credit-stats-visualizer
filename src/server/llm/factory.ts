import { azureFoundryProvider } from './providers/azure-foundry';
import { bedrockProvider } from './providers/bedrock';
import { groqProvider } from './providers/groq';
import { mockProvider } from './providers/mock';
import { openAiCompatibleProvider } from './providers/openai-compatible';
import {
  ProviderConfigError,
  missingEnv,
  type LlmProvider,
  type ProviderId,
} from './provider';

/**
 * One factory, reading `LLM_PROVIDER`. A provider whose environment is
 * incomplete throws a `ProviderConfigError` naming exactly what is missing —
 * the failure a person can act on, rather than a 401 from a vendor.
 */

const PROVIDER_IDS: readonly ProviderId[] = [
  'mock',
  'azure-foundry',
  'bedrock',
  'groq',
  'openai-compatible',
];

/** Which env vars each provider cannot work without. */
export const REQUIRED_ENV: Readonly<Record<ProviderId, readonly string[]>> = {
  mock: [],
  'azure-foundry': [
    'AZURE_AI_ENDPOINT',
    'AZURE_AI_API_KEY',
    'AZURE_AI_DEPLOYMENT',
    'AZURE_AI_API_VERSION',
  ],
  // Credentials come from the standard AWS chain, so only the model is ours.
  bedrock: ['BEDROCK_MODEL_ID'],
  groq: ['GROQ_API_KEY', 'GROQ_MODEL'],
  'openai-compatible': [
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_MODEL',
  ],
};

export function configuredProviderId(): ProviderId {
  const raw = (process.env.LLM_PROVIDER ?? 'mock').trim();
  return (PROVIDER_IDS as readonly string[]).includes(raw) ? (raw as ProviderId) : 'mock';
}

export function providerIsConfigured(id: ProviderId = configuredProviderId()): boolean {
  return missingEnv(REQUIRED_ENV[id]).length === 0;
}

export function providerMissingEnv(id: ProviderId = configuredProviderId()): string[] {
  return missingEnv(REQUIRED_ENV[id]);
}

/** The model id the active provider will use, for the settings screen. */
export function configuredModelId(id: ProviderId = configuredProviderId()): string {
  switch (id) {
    case 'azure-foundry':
      return process.env.AZURE_AI_DEPLOYMENT ?? '';
    case 'bedrock':
      return process.env.BEDROCK_MODEL_ID ?? '';
    case 'groq':
      return process.env.GROQ_MODEL ?? '';
    case 'openai-compatible':
      return process.env.OPENAI_COMPATIBLE_MODEL ?? '';
    case 'mock':
      return 'mock-fixture';
  }
}

let cached: { id: ProviderId; provider: LlmProvider } | null = null;

export function getLlmProvider(): LlmProvider {
  const id = configuredProviderId();
  if (cached?.id === id) return cached.provider;

  const missing = missingEnv(REQUIRED_ENV[id]);
  if (missing.length > 0) throw new ProviderConfigError(id, missing);

  const provider = build(id);
  cached = { id, provider };
  return provider;
}

/** Tests flip env vars between cases; the memoised provider must not survive. */
export function resetLlmProvider(): void {
  cached = null;
}

function build(id: ProviderId): LlmProvider {
  switch (id) {
    case 'mock':
      return mockProvider();
    case 'azure-foundry':
      return azureFoundryProvider(
        env('AZURE_AI_ENDPOINT'),
        env('AZURE_AI_API_KEY'),
        env('AZURE_AI_DEPLOYMENT'),
        env('AZURE_AI_API_VERSION'),
      );
    case 'bedrock':
      return bedrockProvider(env('BEDROCK_MODEL_ID'), process.env.AWS_REGION ?? 'ap-south-1');
    case 'groq':
      return groqProvider(env('GROQ_MODEL'), env('GROQ_API_KEY'));
    case 'openai-compatible':
      return openAiCompatibleProvider(
        env('OPENAI_COMPATIBLE_MODEL'),
        env('OPENAI_COMPATIBLE_BASE_URL'),
        env('OPENAI_COMPATIBLE_API_KEY'),
      );
  }
}

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}
