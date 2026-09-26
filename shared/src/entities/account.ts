import { z } from 'zod';
import { isoDateSchema, isoInstantSchema, minorSchema } from './common.js';

export const accountTypeSchema = z.enum(['credit_card', 'savings']);
export type AccountType = z.infer<typeof accountTypeSchema>;

/**
 * A card or a savings account. `accountId` is derived from issuer, type and the
 * last four digits (`axis-bank-credit-card-9581`), so next month's statement for
 * the same card lands on the same account without a lookup.
 */
export const accountSchema = z.object({
  accountId: z.string().min(1),
  type: accountTypeSchema,
  issuer: z.string(),
  productName: z.string(),
  displayName: z.string(),
  last4: z.string(),
  maskedNumber: z.string(),
  creditLimitMinor: minorSchema.nullable(),
  cashLimitMinor: minorSchema.nullable(),
  openedAt: isoDateSchema.nullable(),
  createdAt: isoInstantSchema,
});

export type Account = z.infer<typeof accountSchema>;
