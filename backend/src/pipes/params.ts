import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/**
 * The shapes of the ids that appear in URLs. They are derived, so they have a
 * fixed alphabet; anything else is refused before it reaches a query.
 */

/** `axis-bank-credit-card-9581` */
export const accountIdParam = new ZodValidationPipe(
  z.string().regex(/^[a-z0-9-]{1,80}$/, 'expected an account id'),
);

/** `axis-bank-credit-card-9581_2026-06` */
export const statementIdParam = new ZodValidationPipe(
  z.string().regex(/^[a-z0-9-]{1,80}_\d{4}-\d{2}$/, 'expected a statement id'),
);

/** `0003` */
export const txnIdParam = new ZodValidationPipe(
  z.string().regex(/^\d{4,6}$/, 'expected a transaction id'),
);

/** `card`, `savings` or `cashback`. */
export const accountScreenParam = new ZodValidationPipe(z.enum(['card', 'savings', 'cashback']));
