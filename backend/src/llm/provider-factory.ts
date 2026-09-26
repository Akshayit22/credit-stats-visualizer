import type { Env } from '../environment.js';
import { ProviderConfigError, type LlmProvider, type ProviderId } from './provider.js';
import { azureFoundryProvider } from './providers/azure-foundry.js';
import { groqProvider } from './providers/groq.js';
import { mockProvider } from './providers/mock.js';
import { openAiCompatibleProvider } from './providers/openai-compatible.js';

/**
 * Builds the provider `LLM_PROVIDER` names, from the validated environment.
 *
 * A provider whose settings are incomplete throws a `ProviderConfigError`
 * naming exactly what is missing — the failure a person can act on, rather
 * than a 401 from a vendor on the first upload.
 */

type ProviderSetting = keyof Env;

/** The settings each provider cannot work without (the rest have defaults). */
export const REQUIRED_SETTINGS: Readonly<Record<ProviderId, readonly ProviderSetting[]>> = {
  mock: [],
  groq: ['GROQ_API_KEY', 'GROQ_MODEL'],
  'azure-foundry': [
    'AZURE_AI_ENDPOINT',
    'AZURE_AI_API_KEY',
    'AZURE_AI_DEPLOYMENT',
    'AZURE_AI_API_VERSION',
  ],
  'openai-compatible': [
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_MODEL',
  ],
};

/** Names only — never values — of the settings the active provider lacks. */
export function missingSettings(env: Env): string[] {
  return REQUIRED_SETTINGS[env.LLM_PROVIDER].filter((name) => {
    const value = env[name];
    return value === undefined || String(value).trim().length === 0;
  });
}

/** The model the active provider will call, for the settings screen. */
export function configuredModelId(env: Env): string {
  switch (env.LLM_PROVIDER) {
    case 'mock':
      return 'mock-fixture';
    case 'groq':
      return env.GROQ_MODEL;
    case 'azure-foundry':
      return env.AZURE_AI_DEPLOYMENT ?? '';
    case 'openai-compatible':
      return env.OPENAI_COMPATIBLE_MODEL ?? '';
  }
}

export function buildProvider(env: Env): LlmProvider {
  const missing = missingSettings(env);
  if (missing.length > 0) throw new ProviderConfigError(env.LLM_PROVIDER, missing);

  // Every value used below was checked by `missingSettings`; the `?? ''` only
  // satisfies the type checker and is never reached.
  switch (env.LLM_PROVIDER) {
    case 'mock':
      return mockProvider();
    case 'groq':
      return groqProvider(env.GROQ_MODEL, env.GROQ_API_KEY ?? '');
    case 'azure-foundry':
      return azureFoundryProvider(
        env.AZURE_AI_ENDPOINT ?? '',
        env.AZURE_AI_API_KEY ?? '',
        env.AZURE_AI_DEPLOYMENT ?? '',
        env.AZURE_AI_API_VERSION,
      );
    case 'openai-compatible':
      return openAiCompatibleProvider(
        env.OPENAI_COMPATIBLE_MODEL ?? '',
        env.OPENAI_COMPATIBLE_BASE_URL ?? '',
        env.OPENAI_COMPATIBLE_API_KEY ?? '',
      );
  }
}
