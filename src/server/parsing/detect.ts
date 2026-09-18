import { fingerprintHaystack } from '@/shared/statement-text';
import type { AccountType } from '@/shared/types';

/**
 * Which bank, and which kind of statement.
 *
 * Two signals, scored together: **issuer fingerprints** (strings only that bank
 * prints) and a **structural guess** from the shape of the document. The
 * structural guess alone is enough to pick a generic parser or the LLM when the
 * issuer is one we have never seen.
 */

export interface Fingerprint {
  /** The id a parser registers under. */
  id: string;
  issuer: string;
  productName: string;
  accountType: AccountType;
  /** Each hit adds its weight. Lower-cased substrings. */
  markers: ReadonlyArray<{ text: string; weight: number }>;
}

export const FINGERPRINTS: readonly Fingerprint[] = [
  {
    id: 'slice-savings',
    issuer: 'slice small finance bank',
    productName: 'Savings account',
    accountType: 'savings',
    markers: [
      { text: 'slice small finance bank', weight: 5 },
      { text: 'help@slice.bank.in', weight: 4 },
      { text: 'alternate ifsc', weight: 2 },
      { text: 'interest cr. for', weight: 3 },
    ],
  },
  {
    id: 'axis-supermoney-card',
    issuer: 'Axis Bank',
    productName: 'Supermoney RuPay Credit Card',
    accountType: 'credit_card',
    markers: [
      { text: 'axis bank supermoney rupay credit card', weight: 6 },
      { text: 'supermoney', weight: 3 },
      { text: 'cashback details', weight: 2 },
      { text: 'other debit&charges', weight: 3 },
    ],
  },
  // Known issuers with no deterministic parser yet: recognised so the account
  // is named properly and the LLM gets a hint, then handled by the fallback.
  {
    id: 'hdfc-card',
    issuer: 'HDFC Bank',
    productName: 'Credit Card',
    accountType: 'credit_card',
    markers: [
      { text: 'hdfc bank credit card', weight: 5 },
      { text: 'hdfc bank', weight: 2 },
    ],
  },
  {
    id: 'icici-card',
    issuer: 'ICICI Bank',
    productName: 'Credit Card',
    accountType: 'credit_card',
    markers: [
      { text: 'icici bank credit card', weight: 5 },
      { text: 'icici bank', weight: 2 },
    ],
  },
  {
    id: 'sbi-card',
    issuer: 'SBI Card',
    productName: 'Credit Card',
    accountType: 'credit_card',
    markers: [
      { text: 'sbi card', weight: 5 },
      { text: 'sbicard.com', weight: 3 },
    ],
  },
];

const CARD_STRUCTURE = [
  'total payment due',
  'minimum payment due',
  'total amount due',
  'minimum amount due',
  'credit limit',
  'payment due date',
];

const SAVINGS_STRUCTURE = [
  'opening balance',
  'closing balance',
  'total credits',
  'total debits',
  'interest earned',
  'account statement',
];

export interface Detection {
  /** The parser id to try first, or null when nothing matched well enough. */
  parserId: string | null;
  issuer: string;
  productName: string;
  accountType: AccountType;
  confidence: number;
  /** How the type was decided, for the warning we attach to a weak match. */
  reason: string;
}

/** Below this an issuer match is a coincidence, not a recognition. */
const MIN_ISSUER_SCORE = 5;

export function detectStatement(text: string): Detection {
  const haystack = fingerprintHaystack(text);

  let best: { fingerprint: Fingerprint; score: number } | null = null;
  for (const fingerprint of FINGERPRINTS) {
    let score = 0;
    for (const marker of fingerprint.markers) {
      if (haystack.includes(marker.text)) score += marker.weight;
    }
    if (score > 0 && (best === null || score > best.score)) best = { fingerprint, score };
  }

  const structural = guessAccountType(haystack);

  if (best && best.score >= MIN_ISSUER_SCORE) {
    const { fingerprint, score } = best;
    // The structural guess wins a disagreement about the *type* — an issuer can
    // print both a card and a savings statement under the same branding.
    const accountType = structural.type ?? fingerprint.accountType;
    return {
      parserId: accountType === fingerprint.accountType ? fingerprint.id : null,
      issuer: fingerprint.issuer,
      productName: accountType === fingerprint.accountType ? fingerprint.productName : '',
      accountType,
      confidence: Math.min(1, score / 10),
      reason:
        accountType === fingerprint.accountType
          ? `matched ${fingerprint.id}`
          : `matched ${fingerprint.issuer} but the document reads as ${accountType}`,
    };
  }

  return {
    parserId: null,
    issuer: best?.fingerprint.issuer ?? 'Unknown issuer',
    productName: '',
    accountType: structural.type ?? 'credit_card',
    confidence: structural.type ? 0.4 : 0.1,
    reason: structural.reason,
  };
}

function guessAccountType(haystack: string): { type: AccountType | null; reason: string } {
  const cardHits = CARD_STRUCTURE.filter((needle) => haystack.includes(needle)).length;
  const savingsHits = SAVINGS_STRUCTURE.filter((needle) => haystack.includes(needle)).length;
  // A running balance column is the savings tell that a card statement never has.
  const hasRunningBalance = /\bbalance\b/.test(haystack) && haystack.includes('closing balance');

  if (savingsHits >= 3 && hasRunningBalance && savingsHits >= cardHits) {
    return { type: 'savings', reason: 'opening/closing balance and a running balance column' };
  }
  if (cardHits >= 2 && cardHits > savingsHits) {
    return { type: 'credit_card', reason: 'total and minimum payment due' };
  }
  if (savingsHits >= 2) return { type: 'savings', reason: 'opening and closing balance' };
  return { type: null, reason: 'no recognisable statement structure' };
}
