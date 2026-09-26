import { z } from 'zod';
import { isoInstantSchema, minorSchema, periodSchema } from './common.js';

export const categoryTotalSchema = z.object({
  amountMinor: minorSchema,
  count: z.number().int().nonnegative(),
});
export type CategoryTotal = z.infer<typeof categoryTotalSchema>;

export const merchantTotalSchema = z.object({
  merchant: z.string(),
  amountMinor: minorSchema,
  count: z.number().int().nonnegative(),
});
export type MerchantTotal = z.infer<typeof merchantTotalSchema>;

/** The scope of the summary that adds every account together. */
export const ALL_ACCOUNTS_SCOPE = 'ALL';

/**
 * Pre-computed totals for one month. `scope` is an `accountId` for a single
 * account's statement cycle, or `ALL` for the sum of every account's summary.
 */
export const summarySchema = z.object({
  scope: z.string().min(1),
  period: periodSchema,
  spendMinor: minorSchema,
  incomeMinor: minorSchema,
  feesMinor: minorSchema,
  interestMinor: minorSchema,
  cashbackEarnedMinor: minorSchema,
  cashbackCreditedMinor: minorSchema,
  paymentsMinor: minorSchema,
  closingBalanceMinor: minorSchema,
  byCategory: z.record(z.string(), categoryTotalSchema),
  topMerchants: z.array(merchantTotalSchema),
  txnCount: z.number().int().nonnegative(),
  updatedAt: isoInstantSchema,
});

export type Summary = z.infer<typeof summarySchema>;
