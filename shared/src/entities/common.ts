import { z } from 'zod';

/** ISO `YYYY-MM-DD`. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export type IsoDate = string;

/** A statement month, `YYYY-MM`. */
export const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');
export type Period = string;

/** A calendar year, `YYYY`. */
export const yearSchema = z.string().regex(/^\d{4}$/, 'expected YYYY');

/** ISO-8601 UTC instant, e.g. `2026-08-02T04:15:00.000Z`. */
export const isoInstantSchema = z.string().min(1);
export type IsoInstant = string;

/** Integer paise. Money is never a float anywhere in storage or arithmetic. */
export const minorSchema = z.number().int();
