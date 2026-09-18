import type { Category } from './categories';

export type AccountType = 'credit_card' | 'savings';
export type StatementStatus = 'parsing' | 'parsed' | 'needs_review' | 'failed';
export type TxnDirection = 'debit' | 'credit';
export type TxnMode = 'upi' | 'card' | 'interest' | 'fee' | 'payment' | 'other';
export type CategorySource = 'issuer' | 'rule' | 'llm' | 'user';

/** ISO `YYYY-MM-DD`. */
export type IsoDate = string;
/** `YYYY-MM`. */
export type Period = string;
/** ISO-8601 UTC instant, e.g. `2026-08-02T04:15:00.000Z`. */
export type IsoInstant = string;

export interface UserProfile {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string;
  locale: string;
  currency: 'INR';
  createdAt: IsoInstant;
  lastLoginAt: IsoInstant;
  statementCount: number;
}

export interface Account {
  accountId: string;
  type: AccountType;
  issuer: string;
  productName: string;
  displayName: string;
  last4: string;
  maskedNumber: string;
  creditLimitMinor: number | null;
  cashLimitMinor: number | null;
  openedAt: IsoDate | null;
  createdAt: IsoInstant;
}

export interface Reconciliation {
  ok: boolean;
  expectedMinor: number;
  actualMinor: number;
  differenceMinor: number;
  message: string;
}

export interface LlmUsage {
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CreditCardBlock {
  previousBalanceMinor: number;
  paymentsMinor: number;
  creditsMinor: number;
  purchasesMinor: number;
  cashAdvanceMinor: number;
  otherDebitsMinor: number;
  totalDueMinor: number;
  minimumDueMinor: number;
  creditLimitMinor: number;
  availableCreditMinor: number;
  cashLimitMinor: number;
  cashbackEarnedMinor: number;
  cashbackCreditedMinor: number;
  utilisationPct: number;
}

export interface SavingsBlock {
  openingBalanceMinor: number;
  totalCreditsMinor: number;
  totalDebitsMinor: number;
  interestEarnedMinor: number;
  closingBalanceMinor: number;
  generatedAt: IsoDate | null;
}

interface StatementCommon {
  statementId: string;
  accountId: string;
  period: Period;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  statementDate: IsoDate | null;
  dueDate: IsoDate | null;
  status: StatementStatus;
  parser: string;
  llm: LlmUsage | null;
  reconciliation: Reconciliation;
  rowCount: number;
  uploadedAt: IsoInstant;
  contentHash: string;
}

export interface CreditCardStatement extends StatementCommon {
  accountType: 'credit_card';
  card: CreditCardBlock;
}

export interface SavingsStatement extends StatementCommon {
  accountType: 'savings';
  savings: SavingsBlock;
}

export type Statement = CreditCardStatement | SavingsStatement;

export interface Transaction {
  txnId: string;
  accountId: string;
  statementId: string;
  seq: number;
  date: IsoDate;
  descriptionRaw: string;
  counterparty: string;
  merchant: string;
  issuerCategory: string | null;
  category: Category;
  categorySource: CategorySource;
  amountMinor: number;
  direction: TxnDirection;
  mode: TxnMode;
  referenceNo: string | null;
  balanceAfterMinor: number | null;
  cashbackMinor: number | null;
  isFee: boolean;
  isInterest: boolean;
  isPayment: boolean;
  userEdited: boolean;
}

export interface CategoryTotal {
  amountMinor: number;
  count: number;
}

export interface MerchantTotal {
  merchant: string;
  amountMinor: number;
  count: number;
}

export interface Summary {
  scope: 'ALL' | string;
  period: Period;
  spendMinor: number;
  incomeMinor: number;
  feesMinor: number;
  interestMinor: number;
  cashbackEarnedMinor: number;
  cashbackCreditedMinor: number;
  paymentsMinor: number;
  closingBalanceMinor: number;
  byCategory: Record<string, CategoryTotal>;
  topMerchants: MerchantTotal[];
  txnCount: number;
  updatedAt: IsoInstant;
}

/** What the browser posts to `/api/statements` — extracted text, never bytes. */
export interface StatementUploadPayload {
  text: string;
  contentHash: string;
  meta: {
    pageCount: number;
    fileName: string;
    extractedAt: IsoInstant;
  };
}

export interface ParseWarning {
  code: string;
  message: string;
}

export interface ParsedStatementResult {
  statement: Statement;
  account: Account;
  transactions: Transaction[];
  warnings: ParseWarning[];
  duplicate: boolean;
}

export type ApiResponse<T> = { data: T } | { error: { code: string; message: string } };
