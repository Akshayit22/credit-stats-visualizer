import type {
  Account,
  AccountView,
  CreditCardStatement,
  OverviewView,
  Summary,
  Transaction,
  WorkspaceView,
} from '@cred-stats/shared';

/**
 * Small but realistic views, shaped exactly like the API's: an Axis card whose
 * June cycle runs 17 May – 15 Jun, so one of its rows is dated in May.
 */

export const CARD_ID = 'axis-bank-credit-card-9581';

export const CARD: Account = {
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
};

export const JUNE: CreditCardStatement = {
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
    message: '5,808.40 − 5,808.40 − 96.00 + 19,270.34 + 0.00 + 218.04 = 19,392.38',
  },
  rowCount: 3,
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
};

function row(overrides: Partial<Transaction>): Transaction {
  return {
    txnId: '0000',
    accountId: CARD_ID,
    statementId: JUNE.statementId,
    seq: 0,
    date: '2026-06-02',
    descriptionRaw: 'MERCHANT',
    counterparty: '',
    merchant: 'Merchant',
    issuerCategory: null,
    category: 'Shopping',
    categorySource: 'issuer',
    amountMinor: 100_00,
    direction: 'debit',
    mode: 'card',
    referenceNo: null,
    balanceAfterMinor: null,
    cashbackMinor: null,
    isFee: false,
    isInterest: false,
    isPayment: false,
    userEdited: false,
    ...overrides,
  };
}

export const JUNE_ROWS: Transaction[] = [
  row({
    txnId: '0000',
    seq: 0,
    date: '2026-05-25',
    merchant: 'Swiggy',
    category: 'Food & dining',
    amountMinor: 400_00,
    cashbackMinor: 4_00,
  }),
  row({
    txnId: '0001',
    seq: 1,
    date: '2026-06-02',
    merchant: 'Blinkit',
    category: 'Groceries',
    amountMinor: 1_250_00,
  }),
  row({
    txnId: '0002',
    seq: 2,
    date: '2026-06-10',
    merchant: 'GST on fees',
    category: 'Fees & interest',
    amountMinor: 218_04,
    isFee: true,
  }),
];

export const JUNE_SUMMARY: Summary = {
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
  byCategory: {
    'Food & dining': { amountMinor: 400_00, count: 1 },
    Groceries: { amountMinor: 1_250_00, count: 1 },
  },
  topMerchants: [{ merchant: 'Blinkit', amountMinor: 1_250_00, count: 1 }],
  txnCount: 3,
  updatedAt: '2026-06-20T10:00:00.000Z',
};

const WINDOW = {
  mode: 'month' as const,
  periods: [
    '2025-07',
    '2025-08',
    '2025-09',
    '2025-10',
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06',
  ],
  selected: '2026-06',
  year: '2026',
};

export const CARD_VIEW: AccountView = {
  account: CARD,
  statement: JUNE,
  statements: [JUNE],
  transactions: JUNE_ROWS,
  summaries: [JUNE_SUMMARY],
  window: WINDOW,
  periodsWithData: ['2026-06'],
};

export const WORKSPACE: WorkspaceView = {
  accounts: [CARD],
  statements: [JUNE],
  periods: ['2026-06'],
  needsReview: [],
};

export const OVERVIEW_VIEW: OverviewView = {
  accounts: [CARD],
  statements: [JUNE],
  needsReview: [],
  months: [
    {
      period: '2026-06',
      spendMinor: 19_270_34,
      incomeMinor: 0,
      paymentsMinor: 5_808_40,
      cardSpendMinor: 19_270_34,
      cashbackMinor: 267_00,
      feesMinor: 218_04,
      hasAnyStatement: true,
      hasCardStatement: true,
    },
  ],
  window: WINDOW,
};

export const SESSION = {
  userId: 'u'.repeat(32),
  email: 'demo@cred-stats.local',
  name: 'Demo user',
  avatarUrl: '',
};
