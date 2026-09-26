import type { Account, Statement, Summary, Transaction } from '@cred-stats/shared';

/**
 * Small, valid documents for repository and service tests. Each takes
 * overrides so a test states only the fields it is about.
 */

export const CARD_ID = 'axis-bank-credit-card-9581';
export const SAVINGS_ID = 'slice-small-finance-bank-savings-6993';

export function anAccount(overrides: Partial<Account> = {}): Account {
  return {
    accountId: CARD_ID,
    type: 'credit_card',
    issuer: 'Axis Bank',
    productName: 'Supermoney RuPay Credit Card',
    displayName: 'Axis Bank · Supermoney RuPay Credit Card',
    last4: '9581',
    maskedNumber: 'XXXX9581',
    creditLimitMinor: 50_000_00,
    cashLimitMinor: 10_000_00,
    openedAt: null,
    createdAt: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

export function aCardStatement(overrides: Partial<Statement> = {}): Statement {
  return {
    statementId: `${CARD_ID}_2026-06`,
    accountId: CARD_ID,
    accountType: 'credit_card',
    period: '2026-06',
    periodStart: '2026-05-17',
    periodEnd: '2026-06-15',
    statementDate: '2026-06-15',
    dueDate: '2026-07-05',
    status: 'parsed',
    parser: 'deterministic:axis-supermoney-card',
    llm: null,
    reconciliation: {
      ok: true,
      expectedMinor: 19_392_38,
      actualMinor: 19_392_38,
      differenceMinor: 0,
      message: 'Reconciled.',
    },
    rowCount: 2,
    uploadedAt: '2026-06-20T10:00:00.000Z',
    contentHash: 'a'.repeat(64),
    card: {
      previousBalanceMinor: 5_808_40,
      paymentsMinor: 5_808_40,
      creditsMinor: 96_00,
      purchasesMinor: 19_270_34,
      cashAdvanceMinor: 0,
      otherDebitsMinor: 218_04,
      totalDueMinor: 19_392_38,
      minimumDueMinor: 970_00,
      creditLimitMinor: 50_000_00,
      availableCreditMinor: 30_607_62,
      cashLimitMinor: 10_000_00,
      cashbackEarnedMinor: 267_00,
      cashbackCreditedMinor: 96_00,
      utilisationPct: 38.78,
    },
    ...overrides,
  } as Statement;
}

export function aTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    txnId: '0000',
    accountId: CARD_ID,
    statementId: `${CARD_ID}_2026-06`,
    seq: 0,
    date: '2026-05-25',
    descriptionRaw: 'SWIGGY BANGALORE',
    counterparty: 'SWIGGY',
    merchant: 'Swiggy',
    issuerCategory: 'RESTAURANTS',
    category: 'Food & dining',
    categorySource: 'issuer',
    amountMinor: 400_00,
    direction: 'debit',
    mode: 'card',
    referenceNo: null,
    balanceAfterMinor: null,
    cashbackMinor: 4_00,
    isFee: false,
    isInterest: false,
    isPayment: false,
    userEdited: false,
    ...overrides,
  };
}

export function aSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    scope: CARD_ID,
    period: '2026-06',
    spendMinor: 19_270_34,
    incomeMinor: 0,
    feesMinor: 218_04,
    interestMinor: 0,
    cashbackEarnedMinor: 267_00,
    cashbackCreditedMinor: 96_00,
    paymentsMinor: 5_808_40,
    closingBalanceMinor: 19_392_38,
    byCategory: { 'Food & dining': { amountMinor: 400_00, count: 1 } },
    topMerchants: [{ merchant: 'Swiggy', amountMinor: 400_00, count: 1 }],
    txnCount: 15,
    updatedAt: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}
