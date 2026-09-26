import { UNCATEGORISED, type Category, type CategorySource } from '@cred-stats/shared';
import {
  categoryForIssuerCategory,
  categoryForMerchantRule,
  normaliseMerchant,
} from './merchant-rules.js';
import type { ParsedTransaction } from './schemas.js';

/**
 * Categorisation, in the order the build spec lays down:
 *
 *   1. a user rule — someone already recategorised this merchant by hand
 *   2. the issuer's own merchant-category column, mapped onto our taxonomy
 *   3. the built-in merchant rules
 *   4. the LLM, in one batched call for whatever is left
 *   5. Uncategorised
 *
 * A user rule beats the issuer on purpose: the person looking at their own
 * statement knows better than the card network's MCC.
 */

export interface Categorised {
  category: Category;
  source: CategorySource;
}

export interface CategoriseOptions {
  /** normalised merchant → category, from the users table. */
  userRules: Map<string, Category>;
}

/**
 * Everything that does not need a model. Rows it could not place come back as
 * `Uncategorised`, and `unresolvedMerchants` lists what to ask about.
 */
export function categoriseLocally(
  transactions: ParsedTransaction[],
  options: CategoriseOptions,
): { categories: Categorised[]; unresolvedMerchants: string[] } {
  const unresolved = new Set<string>();

  const categories = transactions.map((txn): Categorised => {
    // A user rule wins everything, including the structural flags: the person
    // looking at their own statement knows better than the card network's MCC.
    const userRule = options.userRules.get(normaliseMerchant(merchantLabel(txn)));
    if (userRule) return { category: userRule, source: 'user' };

    const structural = structuralCategory(txn);
    if (structural) return structural;

    const issuer = categoryForIssuerCategory(txn.issuerCategory);
    if (issuer) return { category: issuer, source: 'issuer' };

    const rule = categoryForMerchantRule(`${txn.merchant} ${txn.descriptionRaw}`);
    if (rule) return { category: rule, source: 'rule' };

    const label = merchantLabel(txn);
    if (label.length > 0) unresolved.add(label);
    return { category: UNCATEGORISED, source: 'rule' };
  });

  return { categories, unresolvedMerchants: [...unresolved].slice(0, 60) };
}

/**
 * Flags the parser already set are stronger than any name match: a fee is a fee
 * whatever the merchant column says, and interest is income whatever it is
 * called.
 */
function structuralCategory(txn: ParsedTransaction): Categorised | null {
  // Interest credited to a savings account is income, and it is checked first
  // because the row also reads as a fee-ish word to the merchant rules.
  if (txn.isInterest && txn.direction === 'credit') {
    return { category: 'Income', source: 'rule' };
  }
  if (txn.isFee || txn.isInterest) return { category: 'Fees & interest', source: 'rule' };
  if (txn.isPayment) return { category: 'Cash & transfers', source: 'rule' };
  return null;
}

/** What the LLM is asked about, and what a user rule is keyed on. */
export function merchantLabel(txn: ParsedTransaction): string {
  const candidate = (txn.merchant || txn.counterparty || '').trim();
  if (candidate.length > 0) return candidate.slice(0, 80);
  return txn.descriptionRaw.slice(0, 80);
}

/**
 * Folds the LLM's answers back in. Only rows that are still `Uncategorised` are
 * touched, so a model cannot overrule the issuer, a rule, or the user.
 */
export function applyLlmCategories(
  transactions: ParsedTransaction[],
  categories: Categorised[],
  assignments: ReadonlyArray<{ merchant: string; category: Category }>,
): Categorised[] {
  if (assignments.length === 0) return categories;
  const byMerchant = new Map(
    assignments.map((assignment) => [normaliseMerchant(assignment.merchant), assignment.category]),
  );

  return categories.map((current, index) => {
    if (current.category !== UNCATEGORISED) return current;
    const txn = transactions[index];
    if (!txn) return current;
    const match = byMerchant.get(normaliseMerchant(merchantLabel(txn)));
    return match ? { category: match, source: 'llm' } : current;
  });
}
