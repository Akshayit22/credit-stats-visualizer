/**
 * The fixed internal category taxonomy. Every transaction lands in exactly one
 * of these, whatever the issuer called it. Adding a category is a schema
 * change: stored summaries key their `byCategory` map on these ids.
 */
export const CATEGORIES = [
  'Food & dining',
  'Groceries',
  'Shopping',
  'Clothing',
  'Electronics',
  'Travel',
  'Fuel',
  'Bills & utilities',
  'Rent',
  'Education',
  'Health',
  'Entertainment',
  'Digital & subscriptions',
  'Cash & transfers',
  'Fees & interest',
  'Income',
  'Uncategorised',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const UNCATEGORISED: Category = 'Uncategorised';

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/** Categories that are never "spend" — they must not inflate the spend tiles. */
export const NON_SPEND_CATEGORIES: readonly Category[] = ['Income'];
