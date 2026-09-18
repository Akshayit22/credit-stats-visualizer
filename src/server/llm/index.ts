import type { LlmFallback } from '@/server/domain/ingest';

/**
 * The LLM fallback, resolved from `LLM_PROVIDER`. Filled in by M5 — until then
 * a statement no deterministic parser covers comes back as a clear failure
 * rather than a guess.
 */
export function getLlmFallback(): LlmFallback | null {
  return null;
}
