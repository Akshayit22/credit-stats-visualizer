/**
 * Money is integer paise (`amountMinor`) everywhere in storage and in every
 * calculation. Floats only ever appear at the edges: parsing a printed amount
 * in, and formatting one out.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_WHOLE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** ±₹1.00 — the tolerance every reconciliation check allows. */
export const RECONCILIATION_TOLERANCE_MINOR = 100;

/**
 * Zero-width space, soft hyphen, byte-order mark and non-breaking space. Bank
 * PDFs sprinkle these through amounts and merchant names (the slice statement
 * hides a zero-width space inside `idfcfirst`), so every reader strips them
 * before doing anything else.
 */
export function stripInvisible(text: string): string {
  return text.replace(/[\u200B\u00AD\uFEFF\u2060]/g, '').replace(/\u00A0/g, ' ');
}

/**
 * Parse an Indian-format printed amount into paise.
 * Handles `₹2,30,150.08`, `-₹8,700.00`, `19,392.38`, `1,048.09`, `(250.00)`.
 * Returns `null` when the text holds no amount at all.
 */
export function parseAmountToMinor(raw: string): number | null {
  const text = stripInvisible(raw).trim();
  if (text.length === 0) return null;

  const signChars = text.replace(/[^\d.,()-]/g, '');
  const negative = /^\(.*\)$/.test(text) || signChars.includes('-');

  const digits = text.replace(/[^\d.]/g, '');
  if (digits.length === 0) return null;

  const dot = digits.lastIndexOf('.');
  const whole = dot === -1 ? digits : digits.slice(0, dot);
  const frac = dot === -1 ? '' : digits.slice(dot + 1);
  if (whole.length === 0 && frac.length === 0) return null;

  const paise = `${frac}00`.slice(0, 2);
  const value = Number(whole || '0') * 100 + Number(paise || '0');
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Same as {@link parseAmountToMinor} but throws instead of returning null. */
export function requireAmountMinor(raw: string, what: string): number {
  const value = parseAmountToMinor(raw);
  if (value === null) throw new Error(`Could not read an amount for ${what} from "${raw}"`);
  return value;
}

/** `123456` → `₹1,234.56`. `decimals: 0` rounds to whole rupees for tiles. */
export function formatMinor(amountMinor: number, decimals: 0 | 2 = 2): string {
  const rupees = amountMinor / 100;
  return decimals === 0 ? INR_WHOLE.format(Math.round(rupees)) : INR.format(rupees);
}

/** Compact form for chart axes: `₹1.2L`, `₹26k`, `₹840`. */
export function formatMinorCompact(amountMinor: number): string {
  const rupees = Math.abs(amountMinor) / 100;
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(rupees >= 1000000 ? 0 : 1)}L`;
  if (rupees >= 1000) return `₹${Math.round(rupees / 1000)}k`;
  return `₹${Math.round(rupees)}`;
}

export function formatPct(value: number, decimals = 1): string {
  return `${(Number.isFinite(value) ? value : 0).toFixed(decimals)}%`;
}

/** Rupees as a plain number, for chart values only. Never store this. */
export function toRupees(amountMinor: number): number {
  return amountMinor / 100;
}
