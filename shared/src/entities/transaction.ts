import { z } from 'zod';
import { CATEGORIES } from '../categories.js';
import { isoDateSchema, minorSchema } from './common.js';

export const categorySchema = z.enum(CATEGORIES);

export const txnDirectionSchema = z.enum(['debit', 'credit']);
export type TxnDirection = z.infer<typeof txnDirectionSchema>;

export const txnModeSchema = z.enum(['upi', 'card', 'interest', 'fee', 'payment', 'other']);
export type TxnMode = z.infer<typeof txnModeSchema>;

/** Where a row's category came from, in the order they are tried. */
export const categorySourceSchema = z.enum(['issuer', 'rule', 'llm', 'user']);
export type CategorySource = z.infer<typeof categorySourceSchema>;

export const transactionSchema = z.object({
  /** The row's position in its statement, zero-padded: `0003`. Unique per statement. */
  txnId: z.string().min(1),
  accountId: z.string().min(1),
  statementId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  date: isoDateSchema,
  descriptionRaw: z.string(),
  counterparty: z.string(),
  merchant: z.string(),
  issuerCategory: z.string().nullable(),
  category: categorySchema,
  categorySource: categorySourceSchema,
  /** Always positive; `direction` carries the sign. */
  amountMinor: minorSchema.nonnegative(),
  direction: txnDirectionSchema,
  mode: txnModeSchema,
  referenceNo: z.string().nullable(),
  balanceAfterMinor: minorSchema.nullable(),
  cashbackMinor: minorSchema.nullable(),
  isFee: z.boolean(),
  isInterest: z.boolean(),
  isPayment: z.boolean(),
  userEdited: z.boolean(),
});

export type Transaction = z.infer<typeof transactionSchema>;
