import { z } from 'zod';
import { isoInstantSchema } from './common.js';
import { categorySchema } from './transaction.js';

/**
 * A category the user chose for a merchant. Written when a row is
 * recategorised, so the same merchant lands in the same place on every future
 * statement. `merchant` is normalised: lower case, punctuation collapsed.
 */
export const categoryRuleSchema = z.object({
  merchant: z.string().min(1),
  category: categorySchema,
  updatedAt: isoInstantSchema,
});

export type CategoryRule = z.infer<typeof categoryRuleSchema>;
