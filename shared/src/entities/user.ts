import { z } from 'zod';
import { isoInstantSchema } from './common.js';

/**
 * One person. `userId` is a stable hash of the Google subject — never the
 * subject itself — so the provider's identifier is not what ends up on every
 * document and in every log line.
 */
export const userProfileSchema = z.object({
  userId: z.string().min(1),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string(),
  locale: z.string(),
  currency: z.literal('INR'),
  createdAt: isoInstantSchema,
  lastLoginAt: isoInstantSchema,
  statementCount: z.number().int().nonnegative(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;
