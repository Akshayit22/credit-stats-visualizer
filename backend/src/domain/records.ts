import type {
  Category,
  CategorySource,
  LlmUsage,
  Period,
  Reconciliation,
  Statement,
  StatementStatus,
  Transaction,
} from '@cred-stats/shared';
import { merchantLabel } from './categorise.js';
import { txnIdFor } from './identifiers.js';
import type { ParsedStatement, ParsedTransaction } from './schemas.js';

/**
 * Turning what a parser (or the model) read into the documents that are
 * stored. Pure: the ingest service decides the ids, status and categories and
 * hands them in.
 */

export interface StatementRecordInput {
  parsed: ParsedStatement;
  statementId: string;
  accountId: string;
  period: Period;
  status: StatementStatus;
  parserName: string;
  llmUsage: LlmUsage | null;
  reconciliation: Reconciliation;
  contentHash: string;
  uploadedAt: string;
}

export function buildStatementRecord(input: StatementRecordInput): Statement {
  const common = {
    statementId: input.statementId,
    accountId: input.accountId,
    period: input.period,
    periodStart: input.parsed.periodStart,
    periodEnd: input.parsed.periodEnd,
    statementDate: input.parsed.statementDate,
    dueDate: input.parsed.dueDate,
    status: input.status,
    parser: input.parserName,
    llm: input.llmUsage,
    reconciliation: input.reconciliation,
    rowCount: input.parsed.transactions.length,
    uploadedAt: input.uploadedAt,
    contentHash: input.contentHash,
  };

  if (input.parsed.accountType === 'savings') {
    return { ...common, accountType: 'savings', savings: input.parsed.savings };
  }

  const card = input.parsed.card;
  const utilisationPct =
    card.creditLimitMinor > 0 ? (card.totalDueMinor / card.creditLimitMinor) * 100 : 0;
  return {
    ...common,
    accountType: 'credit_card',
    card: { ...card, utilisationPct: Math.round(utilisationPct * 100) / 100 },
  };
}

export interface TransactionContext {
  accountId: string;
  statementId: string;
  seq: number;
  category: Category;
  categorySource: CategorySource;
}

export function buildTransaction(
  parsed: ParsedTransaction,
  context: TransactionContext,
): Transaction {
  return {
    // Deterministic, so re-parsing the same statement writes the same ids and a
    // stale row can never survive alongside its replacement.
    txnId: txnIdFor(context.seq),
    accountId: context.accountId,
    statementId: context.statementId,
    seq: context.seq,
    date: parsed.date,
    descriptionRaw: parsed.descriptionRaw,
    counterparty: parsed.counterparty,
    merchant: parsed.merchant || merchantLabel(parsed),
    issuerCategory: parsed.issuerCategory,
    category: context.category,
    categorySource: context.categorySource,
    amountMinor: parsed.amountMinor,
    direction: parsed.direction,
    mode: parsed.mode,
    referenceNo: parsed.referenceNo,
    balanceAfterMinor: parsed.balanceAfterMinor,
    cashbackMinor: parsed.cashbackMinor,
    isFee: parsed.isFee,
    isInterest: parsed.isInterest,
    isPayment: parsed.isPayment,
    userEdited: false,
  };
}
