import { z } from 'zod';
import { periodSchema, yearSchema } from '../entities/common.js';
import { categorySchema } from '../entities/transaction.js';

/**
 * What the browser posts to `POST /api/statements`: extracted, redacted text —
 * never PDF bytes, never the password.
 */
export const statementUploadSchema = z.object({
  text: z.string().min(40).max(1_500_000),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  meta: z.object({
    pageCount: z.number().int().min(1).max(200),
    fileName: z.string().max(200).default(''),
    extractedAt: z.string().max(40),
  }),
});
export type StatementUploadPayload = z.input<typeof statementUploadSchema>;

/** `PATCH /api/statements/:statementId/transactions/:txnId`. */
export const recategoriseSchema = z.object({
  category: categorySchema,
  /** Also write a rule so the same merchant lands here on every future statement. */
  applyToMerchant: z.boolean().default(true),
});
export type RecategoriseRequest = z.input<typeof recategoriseSchema>;

/** The exact phrase that has to accompany "delete everything". */
export const DELETE_CONFIRMATION = 'delete my data';

export const deleteProfileSchema = z.object({
  confirm: z.literal(DELETE_CONFIRMATION),
});
export type DeleteProfileRequest = z.input<typeof deleteProfileSchema>;

/** The Google ID token the Sign in with Google button hands the browser. */
export const googleSignInSchema = z.object({
  credential: z.string().min(20).max(8_000),
});
export type GoogleSignInRequest = z.input<typeof googleSignInSchema>;

/**
 * Which months a dashboard shows. Deliberately lenient: an unknown or malformed
 * value falls back to the newest month rather than failing the whole screen.
 */
export const viewQuerySchema = z.object({
  mode: z.string().max(10).optional(),
  period: z.string().max(10).optional(),
  year: z.string().max(10).optional(),
});
export type ViewQuery = z.infer<typeof viewQuerySchema>;

export const transactionsQuerySchema = z.object({
  period: periodSchema,
  accountId: z.string().min(1).max(80).optional(),
});

export const summariesQuerySchema = z.object({
  year: yearSchema.optional(),
  accountId: z.string().min(1).max(80).optional(),
});
