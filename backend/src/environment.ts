import { z } from 'zod';
import { PROVIDER_IDS } from './llm/provider.js';

/**
 * Every environment variable the API reads, validated once at startup.
 *
 * Nothing else in the backend touches `process.env`: services ask the
 * `Environment` provider instead, so a missing or malformed value stops the
 * process at boot with a message naming the variable — not at 2am on the first
 * request that happens to need it.
 */

/** A value that may be absent. `KEY=` in a `.env` file counts as absent. */
const optional = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** `mongodb://localhost:27017` locally, the Atlas SRV string in production. */
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default('cred-stats'),

  /**
   * Which AI provider reads statements no built-in parser covers. `mock` calls
   * no model at all: the built-in parsers still work, anything else is
   * reported as unparsed rather than guessed.
   */
  LLM_PROVIDER: z.enum(PROVIDER_IDS).default('mock'),

  GROQ_API_KEY: optional,
  GROQ_MODEL: z.string().trim().min(1).default('openai/gpt-oss-120b'),

  AZURE_AI_ENDPOINT: optional,
  AZURE_AI_API_KEY: optional,
  AZURE_AI_DEPLOYMENT: optional,
  AZURE_AI_API_VERSION: z.string().trim().min(1).default('2024-10-21'),

  /** Anything speaking OpenAI chat completions: xAI, OpenAI, OpenRouter, Ollama. */
  OPENAI_COMPATIBLE_BASE_URL: optional,
  OPENAI_COMPATIBLE_API_KEY: optional,
  OPENAI_COMPATIBLE_MODEL: optional,
});

export type Env = z.infer<typeof environmentSchema>;
