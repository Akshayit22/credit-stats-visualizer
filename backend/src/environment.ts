import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at startup.
 *
 * Nothing else in the backend touches `process.env`: services ask the
 * `Environment` provider instead, so a missing or malformed value stops the
 * process at boot with a message naming the variable — not at 2am on the first
 * request that happens to need it.
 */
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** `mongodb://localhost:27017` locally, the Atlas SRV string in production. */
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default('cred-stats'),

  /** Which AI provider reads statements no built-in parser covers. */
  LLM_PROVIDER: z.enum(['mock', 'groq', 'azure-foundry', 'openai-compatible']).default('mock'),
});

export type Env = z.infer<typeof environmentSchema>;
