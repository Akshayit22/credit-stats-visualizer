import { z } from 'zod';
import { CATEGORIES } from '@/shared/categories';

/**
 * The shapes a parser — deterministic or LLM — must produce. The LLM's JSON is
 * validated against exactly these, so a model that invents a field or drops one
 * fails loudly instead of quietly writing nonsense into DynamoDB.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Integer paise. Never a float, never negative for an amount. */
const minor = z.number().int();
const positiveMinor = z.number().int().nonnegative();

/**
 * An optional field where "absent" and "null" mean the same thing.
 *
 * `.default()` only fills in `undefined`, and a model asked for a counterparty
 * it cannot see answers `null` rather than omitting the key — a distinction
 * without a difference here. Rejecting it sent a perfectly good extraction
 * round the retry loop and then threw it away.
 */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => value ?? '');

const optionalFlag = z
  .boolean()
  .nullish()
  .transform((value) => value ?? false);

export const txnDirectionSchema = z.enum(['debit', 'credit']);
export const txnModeSchema = z.enum(['upi', 'card', 'interest', 'fee', 'payment', 'other']);
export const accountTypeSchema = z.enum(['credit_card', 'savings']);
export const categorySchema = z.enum(CATEGORIES);

export const parsedTransactionSchema = z.object({
  date: isoDate,
  descriptionRaw: z.string().min(1).max(400),
  counterparty: optionalText(200),
  merchant: optionalText(200),
  issuerCategory: z.string().max(80).nullable().default(null),
  amountMinor: positiveMinor,
  direction: txnDirectionSchema,
  mode: txnModeSchema,
  referenceNo: z.string().max(60).nullable().default(null),
  balanceAfterMinor: minor.nullable().default(null),
  cashbackMinor: positiveMinor.nullable().default(null),
  isFee: optionalFlag,
  isInterest: optionalFlag,
  isPayment: optionalFlag,
});

export type ParsedTransaction = z.infer<typeof parsedTransactionSchema>;

export const parsedAccountSchema = z.object({
  type: accountTypeSchema,
  issuer: z.string().min(1).max(80),
  productName: optionalText(120),
  last4: z.string().regex(/^\d{2,4}$/, 'expected the last digits only'),
  maskedNumber: optionalText(40),
  creditLimitMinor: positiveMinor.nullable().default(null),
  cashLimitMinor: positiveMinor.nullable().default(null),
  openedAt: isoDate.nullable().default(null),
});

export type ParsedAccount = z.infer<typeof parsedAccountSchema>;

export const creditCardBlockSchema = z.object({
  previousBalanceMinor: minor,
  paymentsMinor: minor,
  creditsMinor: minor,
  purchasesMinor: minor,
  cashAdvanceMinor: minor,
  otherDebitsMinor: minor,
  totalDueMinor: minor,
  minimumDueMinor: minor,
  creditLimitMinor: minor,
  availableCreditMinor: minor,
  cashLimitMinor: minor,
  cashbackEarnedMinor: minor,
  cashbackCreditedMinor: minor,
});

export const savingsBlockSchema = z.object({
  openingBalanceMinor: minor,
  totalCreditsMinor: minor,
  totalDebitsMinor: minor,
  interestEarnedMinor: minor,
  closingBalanceMinor: minor,
  generatedAt: isoDate.nullable().default(null),
});

const parsedCommon = {
  periodStart: isoDate,
  periodEnd: isoDate,
  statementDate: isoDate.nullable().default(null),
  dueDate: isoDate.nullable().default(null),
  account: parsedAccountSchema,
  transactions: z.array(parsedTransactionSchema).max(2000),
};

export const parsedStatementSchema = z.discriminatedUnion('accountType', [
  z.object({
    ...parsedCommon,
    accountType: z.literal('credit_card'),
    card: creditCardBlockSchema,
  }),
  z.object({
    ...parsedCommon,
    accountType: z.literal('savings'),
    savings: savingsBlockSchema,
  }),
]);

export type ParsedStatement = z.infer<typeof parsedStatementSchema>;

/**
 * The JSON Schema handed to a provider's structured-output mode. Kept next to
 * the zod schema on purpose: they describe the same thing and drift silently if
 * they live apart.
 */
export const PARSED_STATEMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['accountType', 'periodStart', 'periodEnd', 'account', 'transactions'],
  properties: {
    accountType: { type: 'string', enum: ['credit_card', 'savings'] },
    periodStart: { type: 'string', description: 'YYYY-MM-DD' },
    periodEnd: { type: 'string', description: 'YYYY-MM-DD' },
    statementDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    account: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'issuer', 'last4'],
      properties: {
        type: { type: 'string', enum: ['credit_card', 'savings'] },
        issuer: { type: 'string' },
        productName: { type: 'string' },
        last4: { type: 'string', description: 'the last 4 digits only' },
        maskedNumber: { type: 'string' },
        creditLimitMinor: { type: ['integer', 'null'] },
        cashLimitMinor: { type: ['integer', 'null'] },
        openedAt: { type: ['string', 'null'] },
      },
    },
    card: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        previousBalanceMinor: { type: 'integer' },
        paymentsMinor: { type: 'integer' },
        creditsMinor: { type: 'integer' },
        purchasesMinor: { type: 'integer' },
        cashAdvanceMinor: { type: 'integer' },
        otherDebitsMinor: { type: 'integer' },
        totalDueMinor: { type: 'integer' },
        minimumDueMinor: { type: 'integer' },
        creditLimitMinor: { type: 'integer' },
        availableCreditMinor: { type: 'integer' },
        cashLimitMinor: { type: 'integer' },
        cashbackEarnedMinor: { type: 'integer' },
        cashbackCreditedMinor: { type: 'integer' },
      },
    },
    savings: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        openingBalanceMinor: { type: 'integer' },
        totalCreditsMinor: { type: 'integer' },
        totalDebitsMinor: { type: 'integer' },
        interestEarnedMinor: { type: 'integer' },
        closingBalanceMinor: { type: 'integer' },
        generatedAt: { type: ['string', 'null'] },
      },
    },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'descriptionRaw', 'amountMinor', 'direction', 'mode'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          descriptionRaw: { type: 'string' },
          counterparty: { type: 'string' },
          merchant: { type: 'string' },
          issuerCategory: { type: ['string', 'null'] },
          amountMinor: { type: 'integer', description: 'paise, always positive' },
          direction: { type: 'string', enum: ['debit', 'credit'] },
          mode: { type: 'string', enum: ['upi', 'card', 'interest', 'fee', 'payment', 'other'] },
          referenceNo: { type: ['string', 'null'] },
          balanceAfterMinor: { type: ['integer', 'null'] },
          cashbackMinor: { type: ['integer', 'null'] },
          isFee: { type: 'boolean' },
          isInterest: { type: 'boolean' },
          isPayment: { type: 'boolean' },
        },
      },
    },
  },
} as const;

/** What the LLM returns when it is only being asked to categorise merchants. */
export const merchantCategoriesSchema = z.object({
  assignments: z
    .array(
      z.object({
        merchant: z.string().min(1).max(200),
        category: categorySchema,
      }),
    )
    .max(200),
});

export const MERCHANT_CATEGORIES_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['merchant', 'category'],
        properties: {
          merchant: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
        },
      },
    },
  },
} as const;

/* ── API request schemas ─────────────────────────────────────────────────── */

export const statementUploadSchema = z.object({
  text: z.string().min(40).max(1_500_000),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  meta: z.object({
    pageCount: z.number().int().min(1).max(200),
    fileName: z.string().max(200).default(''),
    extractedAt: z.string().max(40),
  }),
});

export const recategoriseSchema = z.object({
  txnId: z.string().min(1).max(80),
  date: isoDate,
  accountId: z.string().min(1).max(80),
  category: categorySchema,
  /** Also write a user rule so the change sticks for future statements. */
  applyToMerchant: z.boolean().default(true),
});
