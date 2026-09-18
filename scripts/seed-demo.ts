/**
 * Loads demo data so the whole UI is browsable with no Google account, no LLM
 * key and no real PDF.
 *
 *   npm run db:seed
 *
 * The three committed fixtures go through the *real* ingest pipeline, so the
 * demo numbers are the real ones from real statements — a genuine Axis cycle
 * and two genuine slice months. On top of that it synthesises a few earlier
 * months so the year view has something to show and a visible coverage gap,
 * which is the state the design's "Built from 7 of 12 months" note is for.
 */
import { config as loadEnv } from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const { DEV_USER_ID } = await import('../src/server/auth/config');
const { ingestStatement, recomputeSummaries } = await import('../src/server/domain/ingest');
const { upsertUserOnSignIn } = await import('../src/server/db/repositories/users');
const { parserInputFor, runDeterministicParser } = await import('../src/server/parsing/registry');
const { upsertAccountFromStatement } = await import('../src/server/db/repositories/accounts');
const { putStatement, statementIdFor } = await import('../src/server/db/repositories/statements');
const { putTransactions } = await import('../src/server/db/repositories/transactions');
const { categoriseLocally } = await import('../src/server/domain/categorise');
const { reconcile } = await import('../src/server/domain/reconcile');
const { addMonths } = await import('../src/server/domain/dates');
const { formatMinor } = await import('../src/shared/money');

type Statement = import('../src/shared/types').Statement;
type Transaction = import('../src/shared/types').Transaction;

const USER_ID = DEV_USER_ID;

async function main(): Promise<void> {
  console.log(`seeding demo user ${USER_ID.slice(0, 12)}…\n`);

  await upsertUserOnSignIn({
    userId: USER_ID,
    email: 'demo@cred-stats.local',
    name: 'Demo user',
    avatarUrl: '',
  });

  const fixtures = readdirSync(resolve('fixtures')).filter((name) => name.endsWith('.txt'));
  if (fixtures.length === 0) {
    console.error('No fixtures. Run `npm run fixtures:build` with PDFs in samples/ first.');
    process.exitCode = 1;
    return;
  }

  const realPeriods: Array<{ accountId: string; period: string }> = [];

  for (const file of fixtures.sort()) {
    const text = readFileSync(resolve('fixtures', file), 'utf8');
    const contentHash = createHash('sha256').update(text).digest('hex');
    const result = await ingestStatement({ userId: USER_ID, text, contentHash, llm: null });
    realPeriods.push({ accountId: result.account.accountId, period: result.statement.period });
    console.log(
      `  ${result.duplicate ? 'already there' : 'ingested'}  ${file}  ` +
        `${result.statement.period}  ${result.statement.rowCount} rows  ` +
        `${result.statement.status}`,
    );
  }

  const synthesised = await synthesiseEarlierMonths(fixtures);
  console.log(`\n  synthesised ${synthesised} earlier month(s) so the year view has a shape`);

  await recomputeSummaries(
    USER_ID,
    [...new Set(realPeriods.map((entry) => entry.period))],
    null,
  );

  const { listSummaries } = await import('../src/server/db/repositories/summaries');
  const summaries = await listSummaries(USER_ID, 'ALL', '2026');
  console.log('\n  month     spend        income       fees      cashback   rows');
  for (const summary of summaries) {
    console.log(
      `  ${summary.period}  ${pad(formatMinor(summary.spendMinor, 0), 11)}  ` +
        `${pad(formatMinor(summary.incomeMinor, 0), 11)}  ` +
        `${pad(formatMinor(summary.feesMinor, 0), 8)}  ` +
        `${pad(formatMinor(summary.cashbackEarnedMinor, 0), 8)}  ${summary.txnCount}`,
    );
  }

  console.log('\nDone. `npm run dev:nollm` then open http://localhost:3000');
}

function pad(value: string, width: number): string {
  return value.padStart(width, ' ');
}

/**
 * Two earlier months per account, derived from a real one by scaling every row.
 * They are clearly marked `demo:` in the `parser` field so nothing mistakes
 * them for parsed statements, and one month is deliberately left empty so the
 * coverage note and the empty state both have something to show.
 */
async function synthesiseEarlierMonths(fixtures: string[]): Promise<number> {
  let written = 0;

  for (const file of fixtures.sort()) {
    const text = readFileSync(resolve('fixtures', file), 'utf8');
    const attempt = runDeterministicParser(parserInputFor(text));
    const source = attempt?.output?.statement;
    if (!source) continue;

    // Skip one month between the real statement and the synthetic ones, so the
    // library shows a genuine gap.
    for (const [index, back] of [2, 3].entries()) {
      const scale = 0.72 + index * 0.16;
      const shifted = shiftStatement(source, -back, scale);
      const account = await upsertAccountFromStatement(USER_ID, shifted.account);
      const period = shifted.periodEnd.slice(0, 7);
      const statementId = statementIdFor(account.accountId, period);
      const reconciliation = reconcile(shifted);
      const { categories } = categoriseLocally(shifted.transactions, { userRules: new Map() });

      const transactions: Transaction[] = shifted.transactions.map((txn, seq) => ({
        txnId: String(seq).padStart(4, '0'),
        accountId: account.accountId,
        statementId,
        seq,
        date: txn.date,
        descriptionRaw: txn.descriptionRaw,
        counterparty: txn.counterparty,
        merchant: txn.merchant,
        issuerCategory: txn.issuerCategory,
        category: categories[seq]?.category ?? 'Uncategorised',
        categorySource: categories[seq]?.source ?? 'rule',
        amountMinor: txn.amountMinor,
        direction: txn.direction,
        mode: txn.mode,
        referenceNo: txn.referenceNo,
        balanceAfterMinor: txn.balanceAfterMinor,
        cashbackMinor: txn.cashbackMinor,
        isFee: txn.isFee,
        isInterest: txn.isInterest,
        isPayment: txn.isPayment,
        userEdited: false,
      }));

      const base = {
        statementId,
        accountId: account.accountId,
        period,
        periodStart: shifted.periodStart,
        periodEnd: shifted.periodEnd,
        statementDate: shifted.statementDate,
        dueDate: shifted.dueDate,
        status: reconciliation.ok ? ('parsed' as const) : ('needs_review' as const),
        parser: 'demo:synthesised',
        llm: null,
        reconciliation,
        rowCount: transactions.length,
        uploadedAt: new Date(Date.now() - back * 86_400_000 * 30).toISOString(),
        contentHash: createHash('sha256').update(`${statementId}:demo`).digest('hex'),
      };

      const statement: Statement =
        shifted.accountType === 'savings'
          ? { ...base, accountType: 'savings', savings: shifted.savings }
          : {
              ...base,
              accountType: 'credit_card',
              card: {
                ...shifted.card,
                utilisationPct:
                  shifted.card.creditLimitMinor > 0
                    ? Math.round(
                        (shifted.card.totalDueMinor / shifted.card.creditLimitMinor) * 10_000,
                      ) / 100
                    : 0,
              },
            };

      await putTransactions(USER_ID, transactions);
      await putStatement(USER_ID, statement);
      await recomputeSummaries(USER_ID, [period], account.accountId);
      written += 1;
    }
  }

  return written;
}

type Parsed = import('../src/server/domain/schemas').ParsedStatement;

function shiftStatement(source: Parsed, months: number, scale: number): Parsed {
  const shiftDate = (date: string): string => {
    const period = addMonths(date.slice(0, 7), months);
    const day = Number(date.slice(8, 10));
    const lastDay = new Date(
      Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0),
    ).getUTCDate();
    return `${period}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  };
  const scaleMinor = (value: number): number => Math.round(value * scale);

  const transactions = source.transactions.map((txn) => ({
    ...txn,
    date: shiftDate(txn.date),
    amountMinor: scaleMinor(txn.amountMinor),
    balanceAfterMinor: txn.balanceAfterMinor === null ? null : scaleMinor(txn.balanceAfterMinor),
    cashbackMinor: txn.cashbackMinor === null ? null : scaleMinor(txn.cashbackMinor),
  }));

  const common = {
    periodStart: shiftDate(source.periodStart),
    periodEnd: shiftDate(source.periodEnd),
    statementDate: source.statementDate ? shiftDate(source.statementDate) : null,
    dueDate: source.dueDate ? shiftDate(source.dueDate) : null,
    account: source.account,
    transactions,
  };

  if (source.accountType === 'savings') {
    // Recompute the closing balance from the scaled parts so the demo months
    // still reconcile — a demo that fails its own checks teaches nothing.
    const opening = scaleMinor(source.savings.openingBalanceMinor);
    const credits = scaleMinor(source.savings.totalCreditsMinor);
    const debits = scaleMinor(source.savings.totalDebitsMinor);
    const interest = scaleMinor(source.savings.interestEarnedMinor);
    let running = opening;
    for (const txn of transactions) {
      running += txn.direction === 'credit' ? txn.amountMinor : -txn.amountMinor;
      txn.balanceAfterMinor = running;
    }
    return {
      ...common,
      accountType: 'savings',
      savings: {
        openingBalanceMinor: opening,
        totalCreditsMinor: credits,
        totalDebitsMinor: debits,
        interestEarnedMinor: interest,
        closingBalanceMinor: opening + credits + interest - debits,
        generatedAt: source.savings.generatedAt ? shiftDate(source.savings.generatedAt) : null,
      },
    };
  }

  const previous = scaleMinor(source.card.previousBalanceMinor);
  const payments = scaleMinor(source.card.paymentsMinor);
  const credits = scaleMinor(source.card.creditsMinor);
  const purchases = transactions
    .filter((txn) => txn.direction === 'debit' && !txn.isFee)
    .reduce((total, txn) => total + txn.amountMinor, 0);
  const otherDebits = transactions
    .filter((txn) => txn.isFee)
    .reduce((total, txn) => total + txn.amountMinor, 0);

  return {
    ...common,
    accountType: 'credit_card',
    card: {
      previousBalanceMinor: previous,
      paymentsMinor: payments,
      creditsMinor: credits,
      purchasesMinor: purchases,
      cashAdvanceMinor: 0,
      otherDebitsMinor: otherDebits,
      totalDueMinor: previous - payments - credits + purchases + otherDebits,
      minimumDueMinor: scaleMinor(source.card.minimumDueMinor),
      creditLimitMinor: source.card.creditLimitMinor,
      availableCreditMinor: source.card.availableCreditMinor,
      cashLimitMinor: source.card.cashLimitMinor,
      cashbackEarnedMinor: transactions.reduce(
        (total, txn) => total + (txn.cashbackMinor ?? 0),
        0,
      ),
      cashbackCreditedMinor: scaleMinor(source.card.cashbackCreditedMinor),
    },
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
