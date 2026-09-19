import { createHash } from 'node:crypto';
import { redactForStorage } from '@/shared/redact';
import type {
  Account,
  ParseWarning,
  ParsedStatementResult,
  Statement,
  StatementStatus,
  Summary,
  Transaction,
} from '@/shared/types';
import { logger } from '@/server/log';
import { userIdLogPrefix } from '@/server/auth/user-id';
import { parserInputFor, runDeterministicParser } from '@/server/parsing/registry';
import { accountIdFor, upsertAccountFromStatement } from '@/server/db/repositories/accounts';
import {
  findByContentHash,
  putStatement,
  statementIdFor,
} from '@/server/db/repositories/statements';
import {
  deleteTransactionsForStatement,
  listTransactionsForStatement,
  putTransactions,
} from '@/server/db/repositories/transactions';
import { deleteSummary, listSummaries, putSummary } from '@/server/db/repositories/summaries';
import { listStatements } from '@/server/db/repositories/statements';
import { bumpStatementCount, listUserRules } from '@/server/db/repositories/users';
import { applyLlmCategories, categoriseLocally, merchantLabel } from './categorise';
import { periodForStatement } from './dates';
import { checkCashback, reconcile } from './reconcile';
import { aggregateSummaries, buildSummary } from './summarise';
import type { ParsedStatement, ParsedTransaction } from './schemas';

/**
 * The server half of the parse pipeline:
 *
 *   redact again (defence in depth)  →  detect  →  deterministic parser, else
 *   the LLM  →  reconcile  →  categorise  →  write statement, transactions and
 *   the affected summaries  →  answer with the parsed statement and warnings.
 *
 * The LLM steps arrive behind `llmFallback`, which M5 fills in. Until then a
 * statement no deterministic parser handles comes back `failed` with a warning
 * that says so, rather than pretending.
 */

export interface LlmFallback {
  extract(text: string, hint: { issuer: string; accountType: string }): Promise<{
    statement: ParsedStatement;
    usage: { provider: string; modelId: string; inputTokens: number; outputTokens: number };
  }>;
  categorise(merchants: string[]): Promise<{
    assignments: Array<{ merchant: string; category: Transaction['category'] }>;
    usage: { provider: string; modelId: string; inputTokens: number; outputTokens: number };
  }>;
}

export interface IngestInput {
  userId: string;
  /** Already redacted by the browser; redacted again here regardless. */
  text: string;
  contentHash: string;
  llm?: LlmFallback | null;
}

export async function ingestStatement(input: IngestInput): Promise<ParsedStatementResult> {
  const started = Date.now();
  const warnings: ParseWarning[] = [];

  // 1. Redact again. The browser already did this, but the server must not
  //    trust that the text it received came from our own client.
  const { text, counts } = redactForStorage(input.text);
  const redactedHere = Object.values(counts).reduce((total, n) => total + n, 0);
  if (redactedHere > 0) {
    warnings.push({
      code: 'server_redaction',
      message: `The server removed ${redactedHere} further identifier(s) before parsing.`,
    });
  }

  // 2. The hash is taken over the text the server ends up with, so the record
  //    of "have I seen this file?" cannot be spoofed by a doctored client hash.
  const contentHash = createHash('sha256').update(text).digest('hex');
  if (contentHash !== input.contentHash) {
    warnings.push({
      code: 'hash_mismatch',
      message:
        'The content hash was recomputed on the server because it did not match the one sent.',
    });
  }

  const existing = await findByContentHash(input.userId, contentHash);
  if (existing) {
    const account = await upsertExistingAccount(input.userId, existing);
    return {
      statement: existing,
      account,
      transactions: [],
      warnings: [
        {
          code: 'duplicate',
          message: 'This statement has already been uploaded. Showing the one already saved.',
        },
      ],
      duplicate: true,
    };
  }

  // 3–7. Detect, parse, fall back.
  const parserInput = parserInputFor(text);
  const attempt = runDeterministicParser(parserInput);

  let parsed: ParsedStatement | null = attempt?.output?.statement ?? null;
  let parserName = attempt ? `deterministic:${attempt.parserId}` : 'none';
  let llmUsage: Statement['llm'] = null;

  if (attempt?.error) {
    warnings.push({
      code: 'deterministic_failed',
      message: `The ${attempt.parserId} parser could not read this file (${attempt.error}).`,
    });
  }
  if (attempt?.output) warnings.push(...attempt.output.warnings);

  // 8. Reconcile. A deterministic parse that does not reconcile is also a
  //    reason to try the model — the spec asks for exactly that.
  let reconciliation = parsed ? reconcile(parsed) : null;

  const needsLlm = parsed === null || reconciliation?.ok === false;
  if (needsLlm && input.llm) {
    try {
      const result = await input.llm.extract(text, {
        issuer: parserInput.detection.issuer,
        accountType: parserInput.detection.accountType,
      });
      const llmReconciliation = reconcile(result.statement);
      // Only take the model's answer if it is at least as good as what we have.
      if (parsed === null || llmReconciliation.ok) {
        parsed = result.statement;
        reconciliation = llmReconciliation;
        parserName = 'llm';
        llmUsage = result.usage;
        warnings.push({
          code: 'llm_used',
          message:
            attempt === null
              ? 'No built-in parser covers this bank, so the figures were extracted by the model.'
              : 'The built-in parser did not reconcile, so the figures were extracted by the model.',
        });
      }
    } catch (error) {
      warnings.push({
        code: 'llm_failed',
        message: `The model could not extract this statement (${
          error instanceof Error ? error.name : 'unknown error'
        }).`,
      });
    }
  }

  if (!parsed || !reconciliation) {
    throw new UnparseableStatementError(
      parserInput.detection.parserId === null
        ? `No parser recognised this statement (${parserInput.detection.reason}), and no AI provider is configured to fall back to.`
        : 'The statement could not be parsed.',
    );
  }

  // 9. Categorise: user rules, then the issuer's column, then our rules, then
  //    the model for whatever is left.
  const userRules = await listUserRules(input.userId);
  const local = categoriseLocally(parsed.transactions, { userRules });
  let categories = local.categories;

  if (local.unresolvedMerchants.length > 0 && input.llm) {
    try {
      const result = await input.llm.categorise(local.unresolvedMerchants);
      categories = applyLlmCategories(parsed.transactions, categories, result.assignments);
      if (!llmUsage) llmUsage = result.usage;
    } catch {
      warnings.push({
        code: 'llm_categorise_failed',
        message: `${local.unresolvedMerchants.length} merchant(s) could not be categorised and were left as Uncategorised.`,
      });
    }
  } else if (local.unresolvedMerchants.length > 0) {
    warnings.push({
      code: 'uncategorised',
      message: `${local.unresolvedMerchants.length} merchant(s) had no matching rule and were left as Uncategorised.`,
    });
  }

  if (parsed.accountType === 'credit_card') {
    const cashback = checkCashback(parsed);
    if (!cashback.ok) {
      warnings.push({
        code: 'cashback_mismatch',
        message:
          'The per-transaction cashback column does not add up to the cashback the statement states. ' +
          'That is usually the issuer capping it, and both figures are kept.',
      });
    }
  }

  // 10. Write.
  const account = await upsertAccountFromStatement(input.userId, parsed.account);
  const period = periodForStatement(parsed.periodEnd);
  const statementId = statementIdFor(account.accountId, period);
  const status: StatementStatus = reconciliation.ok ? 'parsed' : 'needs_review';

  const statement = buildStatementRecord({
    parsed,
    statementId,
    accountId: account.accountId,
    period,
    status,
    parserName,
    llmUsage,
    reconciliation,
    contentHash,
  });

  const transactions = parsed.transactions.map((txn, index) =>
    toTransaction(txn, {
      accountId: account.accountId,
      statementId,
      seq: index,
      category: categories[index]?.category ?? 'Uncategorised',
      categorySource: categories[index]?.source ?? 'rule',
    }),
  );

  // Replace rather than add: a re-parse of the same period must not double up.
  await deleteTransactionsForStatement(input.userId, statementId);
  await putTransactions(input.userId, transactions);
  await putStatement(input.userId, statement);
  await bumpStatementCount(input.userId, 1);
  await recomputeSummaries(input.userId, [period], account.accountId);

  logger.info('statement.ingested', {
    user: userIdLogPrefix(input.userId),
    parser: parserName,
    accountType: statement.accountType,
    rows: transactions.length,
    status,
    reconciled: reconciliation.ok,
    provider: llmUsage?.provider,
    modelId: llmUsage?.modelId,
    inputTokens: llmUsage?.inputTokens,
    outputTokens: llmUsage?.outputTokens,
    durationMs: Date.now() - started,
  });

  return { statement, account, transactions, warnings, duplicate: false };
}

export class UnparseableStatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnparseableStatementError';
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function buildStatementRecord(args: {
  parsed: ParsedStatement;
  statementId: string;
  accountId: string;
  period: string;
  status: StatementStatus;
  parserName: string;
  llmUsage: Statement['llm'];
  reconciliation: Statement['reconciliation'];
  contentHash: string;
}): Statement {
  const common = {
    statementId: args.statementId,
    accountId: args.accountId,
    period: args.period,
    periodStart: args.parsed.periodStart,
    periodEnd: args.parsed.periodEnd,
    statementDate: args.parsed.statementDate,
    dueDate: args.parsed.dueDate,
    status: args.status,
    parser: args.parserName,
    llm: args.llmUsage,
    reconciliation: args.reconciliation,
    rowCount: args.parsed.transactions.length,
    uploadedAt: new Date().toISOString(),
    contentHash: args.contentHash,
  };

  if (args.parsed.accountType === 'savings') {
    return { ...common, accountType: 'savings', savings: args.parsed.savings };
  }

  const card = args.parsed.card;
  const utilisationPct =
    card.creditLimitMinor > 0 ? (card.totalDueMinor / card.creditLimitMinor) * 100 : 0;
  return {
    ...common,
    accountType: 'credit_card',
    card: { ...card, utilisationPct: Math.round(utilisationPct * 100) / 100 },
  };
}

function toTransaction(
  parsed: ParsedTransaction,
  context: {
    accountId: string;
    statementId: string;
    seq: number;
    category: Transaction['category'];
    categorySource: Transaction['categorySource'];
  },
): Transaction {
  return {
    // Deterministic, so re-parsing the same statement writes the same keys and
    // a stale row can never survive alongside its replacement.
    txnId: `${String(context.seq).padStart(4, '0')}`,
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

/**
 * Recomputes the `ACCOUNT#<id>#<period>` summaries for the affected months and
 * then the `ALL#<period>` summary as their sum. Always from what is stored,
 * never incremental — that is what makes re-parsing a statement idempotent.
 *
 * An account's month is its **statement**, not the calendar month. The Axis
 * cycle runs 17 May to 15 Jun, so four of its rows are dated in May; counting by
 * date would split the June bill across two months and understate both.
 */
export async function recomputeSummaries(
  userId: string,
  periods: string[],
  accountId: string | null,
): Promise<void> {
  const statements = await listStatements(userId);

  for (const period of periods) {
    const inPeriod = statements.filter((statement) => statement.period === period);
    const accountIds = new Set<string>(inPeriod.map((statement) => statement.accountId));
    if (accountId) accountIds.add(accountId);

    for (const id of accountIds) {
      const statement = inPeriod.find((candidate) => candidate.accountId === id) ?? null;

      // No statement for this account in this month means the month is empty,
      // even if rows dated inside it exist — a card cycle running 17 May to
      // 15 Jun puts four June-statement rows in May, and counting those as a
      // May summary invents a month the user never uploaded.
      if (!statement) {
        await deleteSummary(userId, id, period);
        continue;
      }

      await putSummary(
        userId,
        buildSummary({
          scope: id,
          period,
          transactions: await listTransactionsForStatement(userId, statement.statementId),
          statements: [statement],
        }),
      );
    }

    // Then the month across accounts, as the sum of what each account's
    // statement said — re-read rather than reused, so a summary written by an
    // earlier request is included too.
    const year = period.slice(0, 4);
    const parts: Summary[] = [];
    for (const id of await accountIdsWithData(userId, statements)) {
      const forAccount = await listSummaries(userId, id, year);
      const match = forAccount.find((summary) => summary.period === period);
      if (match && match.txnCount > 0) parts.push(match);
    }

    if (parts.length === 0) await deleteSummary(userId, 'ALL', period);
    else await putSummary(userId, aggregateSummaries(period, parts));
  }
}

async function accountIdsWithData(userId: string, statements: Statement[]): Promise<string[]> {
  const fromStatements = new Set(statements.map((statement) => statement.accountId));
  const { listAccounts } = await import('@/server/db/repositories/accounts');
  for (const account of await listAccounts(userId)) fromStatements.add(account.accountId);
  return [...fromStatements];
}

async function upsertExistingAccount(userId: string, statement: Statement): Promise<Account> {
  const { getAccount } = await import('@/server/db/repositories/accounts');
  const account = await getAccount(userId, statement.accountId);
  if (account) return account;
  // Should not happen, but a statement without its account is recoverable.
  return {
    accountId: statement.accountId,
    type: statement.accountType,
    issuer: '',
    productName: '',
    displayName: statement.accountId,
    last4: statement.accountId.slice(-4),
    maskedNumber: `XXXX${statement.accountId.slice(-4)}`,
    creditLimitMinor: null,
    cashLimitMinor: null,
    openedAt: null,
    createdAt: statement.uploadedAt,
  };
}

export { accountIdFor };
