import type { LlmFallback } from '@/server/domain/ingest';
import type { ProviderInfo } from '@/client/screens/settings-screen';

/**
 * The LLM fallback, resolved from `LLM_PROVIDER`. Filled in by M5 — until then
 * a statement no deterministic parser covers comes back as a clear failure
 * rather than a guess.
 */
export function getLlmFallback(): LlmFallback | null {
  return null;
}

export function describeProvider(): ProviderInfo {
  const id = process.env.LLM_PROVIDER ?? 'mock';
  return {
    id,
    modelId: '',
    configured: id === 'mock',
    missing: [],
    note: 'Provider wiring arrives in M5.',
  };
}
