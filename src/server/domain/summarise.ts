import type { CategoryTotal, MerchantTotal, Period, Statement, Summary, Transaction } from '@/shared/types';

/**
 * Summaries are **recomputed** from the rows of the affected month, never
 * incremented. That is what makes a re-parse idempotent: upload the same
 * statement twice and the numbers do not double.
 *
 * What each field means, decided once here so every screen agrees:
 *
 *   spendMinor       every debit that is not a bill payment. On a card that is
 *                    purchases plus charges; on savings it is money out.
 *   incomeMinor      every credit that is not a bill payment, a cashback
 *                    credit, or interest — on savings, money in.
 *   feesMinor        debits flagged `isFee`. Card interest charged is a fee.
 *   interestMinor    credits flagged `isInterest` — savings interest earned.
 *   paymentsMinor    rows flagged `isPayment` — a card bill being paid.
 *   closingBalanceMinor
 *                    the statement's own figure: total due on a card, closing
 *                    balance on savings. Derived from rows it would be a guess.
 */

const TOP_MERCHANTS = 8;

export interface SummaryInput {
  scope: 'ALL' | string;
  period: Period;
  transactions: Transaction[];
  /** The statements covering this period and scope, for the figures rows cannot give. */
  statements: Statement[];
}

export function buildSummary(input: SummaryInput): Summary {
  let spendMinor = 0;
  let incomeMinor = 0;
  let feesMinor = 0;
  let interestMinor = 0;
  let paymentsMinor = 0;
  let cashbackEarnedFromRows = 0;

  const byCategory: Record<string, CategoryTotal> = {};
  const merchantTotals = new Map<string, MerchantTotal>();

  for (const txn of input.transactions) {
    if (txn.isPayment) {
      paymentsMinor += txn.amountMinor;
    } else if (txn.direction === 'debit') {
      spendMinor += txn.amountMinor;
    } else if (txn.isInterest) {
      interestMinor += txn.amountMinor;
    } else if (!isCashbackCredit(txn)) {
      incomeMinor += txn.amountMinor;
    }

    if (txn.isFee && txn.direction === 'debit') feesMinor += txn.amountMinor;
    cashbackEarnedFromRows += txn.cashbackMinor ?? 0;

    const bucket = byCategory[txn.category] ?? { amountMinor: 0, count: 0 };
    bucket.amountMinor += txn.amountMinor;
    bucket.count += 1;
    byCategory[txn.category] = bucket;

    // Top merchants is about where money went, so payments and credits are out.
    if (txn.direction === 'debit' && !txn.isPayment) {
      const name = txn.merchant || txn.counterparty || txn.descriptionRaw.slice(0, 60);
      const entry = merchantTotals.get(name) ?? { merchant: name, amountMinor: 0, count: 0 };
      entry.amountMinor += txn.amountMinor;
      entry.count += 1;
      merchantTotals.set(name, entry);
    }
  }

  const statementFigures = fromStatements(input.statements);

  return {
    scope: input.scope,
    period: input.period,
    spendMinor,
    incomeMinor,
    feesMinor,
    interestMinor,
    // The statement's own cashback figure wins when it has one: the issuer caps
    // and adjusts cashback outside the per-row column.
    cashbackEarnedMinor: statementFigures.cashbackEarnedMinor || cashbackEarnedFromRows,
    cashbackCreditedMinor: statementFigures.cashbackCreditedMinor,
    paymentsMinor,
    closingBalanceMinor: statementFigures.closingBalanceMinor,
    byCategory,
    topMerchants: [...merchantTotals.values()]
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .slice(0, TOP_MERCHANTS),
    txnCount: input.transactions.length,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The `ALL#<period>` summary is the sum of that period's account summaries, not
 * a fresh pass over calendar-month rows. A card cycle straddles two months — the
 * Axis statement runs 17 May to 15 Jun — so counting rows by their date would
 * split every bill across two months and make "Bill by month" understate all of
 * them. A month means "what each account's statement for that month said".
 */
export function aggregateSummaries(period: Period, parts: Summary[]): Summary {
  const byCategory: Record<string, CategoryTotal> = {};
  const merchants = new Map<string, MerchantTotal>();

  for (const part of parts) {
    for (const [category, totals] of Object.entries(part.byCategory)) {
      const bucket = byCategory[category] ?? { amountMinor: 0, count: 0 };
      bucket.amountMinor += totals.amountMinor;
      bucket.count += totals.count;
      byCategory[category] = bucket;
    }
    for (const merchant of part.topMerchants) {
      const entry = merchants.get(merchant.merchant) ?? {
        merchant: merchant.merchant,
        amountMinor: 0,
        count: 0,
      };
      entry.amountMinor += merchant.amountMinor;
      entry.count += merchant.count;
      merchants.set(merchant.merchant, entry);
    }
  }

  const sum = (pick: (part: Summary) => number) =>
    parts.reduce((total, part) => total + pick(part), 0);

  return {
    scope: 'ALL',
    period,
    spendMinor: sum((part) => part.spendMinor),
    incomeMinor: sum((part) => part.incomeMinor),
    feesMinor: sum((part) => part.feesMinor),
    interestMinor: sum((part) => part.interestMinor),
    cashbackEarnedMinor: sum((part) => part.cashbackEarnedMinor),
    cashbackCreditedMinor: sum((part) => part.cashbackCreditedMinor),
    paymentsMinor: sum((part) => part.paymentsMinor),
    closingBalanceMinor: sum((part) => part.closingBalanceMinor),
    byCategory,
    topMerchants: [...merchants.values()]
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .slice(0, TOP_MERCHANTS),
    txnCount: sum((part) => part.txnCount),
    updatedAt: new Date().toISOString(),
  };
}

function isCashbackCredit(txn: Transaction): boolean {
  return txn.direction === 'credit' && /cashback/i.test(txn.merchant || txn.descriptionRaw);
}

function fromStatements(statements: Statement[]): {
  closingBalanceMinor: number;
  cashbackEarnedMinor: number;
  cashbackCreditedMinor: number;
} {
  let closingBalanceMinor = 0;
  let cashbackEarnedMinor = 0;
  let cashbackCreditedMinor = 0;

  for (const statement of statements) {
    if (statement.accountType === 'credit_card') {
      closingBalanceMinor += statement.card.totalDueMinor;
      cashbackEarnedMinor += statement.card.cashbackEarnedMinor;
      cashbackCreditedMinor += statement.card.cashbackCreditedMinor;
    } else {
      closingBalanceMinor += statement.savings.closingBalanceMinor;
    }
  }

  return { closingBalanceMinor, cashbackEarnedMinor, cashbackCreditedMinor };
}
