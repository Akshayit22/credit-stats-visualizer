import { z } from 'zod';
import { isoDateSchema, isoInstantSchema, minorSchema, periodSchema } from './common.js';

export const statementStatusSchema = z.enum(['parsing', 'parsed', 'needs_review', 'failed']);
export type StatementStatus = z.infer<typeof statementStatusSchema>;

/** Whether the statement's own figures add up — within ±₹1. */
export const reconciliationSchema = z.object({
  ok: z.boolean(),
  expectedMinor: minorSchema,
  actualMinor: minorSchema,
  differenceMinor: minorSchema,
  message: z.string(),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

/** Which model read the statement, when one did. Token counts only — never text. */
export const llmUsageSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type LlmUsage = z.infer<typeof llmUsageSchema>;

export const creditCardBlockSchema = z.object({
  previousBalanceMinor: minorSchema,
  paymentsMinor: minorSchema,
  creditsMinor: minorSchema,
  purchasesMinor: minorSchema,
  cashAdvanceMinor: minorSchema,
  otherDebitsMinor: minorSchema,
  totalDueMinor: minorSchema,
  minimumDueMinor: minorSchema,
  creditLimitMinor: minorSchema,
  availableCreditMinor: minorSchema,
  cashLimitMinor: minorSchema,
  cashbackEarnedMinor: minorSchema,
  cashbackCreditedMinor: minorSchema,
  utilisationPct: z.number(),
});
export type CreditCardBlock = z.infer<typeof creditCardBlockSchema>;

export const savingsBlockSchema = z.object({
  openingBalanceMinor: minorSchema,
  totalCreditsMinor: minorSchema,
  totalDebitsMinor: minorSchema,
  interestEarnedMinor: minorSchema,
  closingBalanceMinor: minorSchema,
  generatedAt: isoDateSchema.nullable(),
});
export type SavingsBlock = z.infer<typeof savingsBlockSchema>;

const statementCommon = {
  /** `<accountId>_<period>` — deterministic, so a re-parse replaces the old one. */
  statementId: z.string().min(1),
  accountId: z.string().min(1),
  /** The month the statement's period ends in: a 17 May – 15 Jun cycle is June. */
  period: periodSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  statementDate: isoDateSchema.nullable(),
  dueDate: isoDateSchema.nullable(),
  status: statementStatusSchema,
  parser: z.string(),
  llm: llmUsageSchema.nullable(),
  reconciliation: reconciliationSchema,
  rowCount: z.number().int().nonnegative(),
  uploadedAt: isoInstantSchema,
  /** sha256 of the redacted, normalised text — never depends on PII. */
  contentHash: z.string(),
};

export const creditCardStatementSchema = z.object({
  ...statementCommon,
  accountType: z.literal('credit_card'),
  card: creditCardBlockSchema,
});
export type CreditCardStatement = z.infer<typeof creditCardStatementSchema>;

export const savingsStatementSchema = z.object({
  ...statementCommon,
  accountType: z.literal('savings'),
  savings: savingsBlockSchema,
});
export type SavingsStatement = z.infer<typeof savingsStatementSchema>;

export const statementSchema = z.discriminatedUnion('accountType', [
  creditCardStatementSchema,
  savingsStatementSchema,
]);
export type Statement = z.infer<typeof statementSchema>;
