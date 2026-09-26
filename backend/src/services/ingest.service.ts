import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  periodForStatement,
  redactForStorage,
  type Account,
  type LlmUsage,
  type ParseWarning,
  type ParsedStatementResult,
  type Statement,
  type StatementStatus,
} from '@cred-stats/shared';
import { mergeAccount } from '../domain/accounts.js';
import { applyLlmCategories, categoriseLocally } from '../domain/categorise.js';
import { accountIdFor, statementIdFor } from '../domain/identifiers.js';
import { checkCashback, reconcile } from '../domain/reconcile.js';
import { buildStatementRecord, buildTransaction } from '../domain/records.js';
import type { ParsedStatement } from '../domain/schemas.js';
import { ApiException } from '../filters/api-exception.js';
import { LlmRateLimitError, LlmRequestTooLargeError } from '../llm/provider.js';
import type { Detection } from '../parsing/detect.js';
import { parserInputFor, runDeterministicParser } from '../parsing/registry.js';
import { AccountsRepository } from '../repositories/accounts.repository.js';
import { CategoryRulesRepository } from '../repositories/category-rules.repository.js';
import { StatementsRepository } from '../repositories/statements.repository.js';
import { TransactionsRepository } from '../repositories/transactions.repository.js';
import { UsersRepository } from '../repositories/users.repository.js';
import { LlmService } from './llm.service.js';
import { LogService, userIdLogPrefix } from './log.service.js';
import { SummaryService } from './summary.service.js';

export interface IngestInput {
  userId: string;
  /** Already redacted by the browser; redacted again here regardless. */
  text: string;
  contentHash: string;
}

/**
 * The server half of the parse pipeline:
 *
 *   redact again  →  duplicate check  →  detect  →  deterministic parser, else
 *   the model  →  reconcile  →  categorise  →  write the statement, its rows
 *   and the affected summaries  →  answer with the result and any warnings.
 *
 * A statement that cannot be read at all is refused with a sentence the user
 * can act on. One that was read but does not add up is stored as
 * `needs_review` — never quietly wrong.
 */
@Injectable()
export class IngestService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly statements: StatementsRepository,
    private readonly transactions: TransactionsRepository,
    private readonly users: UsersRepository,
    private readonly rules: CategoryRulesRepository,
    private readonly summaries: SummaryService,
    private readonly llm: LlmService,
    private readonly log: LogService,
  ) {}

  async ingest(input: IngestInput): Promise<ParsedStatementResult> {
    const started = Date.now();
    const warnings: ParseWarning[] = [];

    // 1. Redact again. The browser already did, but the server must not trust
    //    that the text it received came from our own client.
    const { text, counts } = redactForStorage(input.text);
    const redactedHere = Object.values(counts).reduce((total, n) => total + n, 0);
    if (redactedHere > 0) {
      warnings.push({
        code: 'server_redaction',
        message: `The server removed ${redactedHere} further identifier(s) before parsing.`,
      });
    }

    // 2. The hash is taken over the text the server ends up with, so "have I
    //    seen this file?" cannot be spoofed by a doctored client hash.
    const contentHash = createHash('sha256').update(text).digest('hex');
    if (contentHash !== input.contentHash) {
      warnings.push({
        code: 'hash_mismatch',
        message:
          'The content hash was recomputed on the server because it did not match the one sent.',
      });
    }

    const existing = await this.statements.findByContentHash(input.userId, contentHash);
    if (existing) return this.duplicateOf(input.userId, existing);

    // 3. Detect and parse, falling back to the model.
    const parserInput = parserInputFor(text);
    const attempt = runDeterministicParser(parserInput);

    let parsed: ParsedStatement | null = attempt?.output?.statement ?? null;
    let parserName = attempt ? `deterministic:${attempt.parserId}` : 'none';
    let llmUsage: LlmUsage | null = null;

    if (attempt?.error) {
      warnings.push({
        code: 'deterministic_failed',
        message: `The ${attempt.parserId} parser could not read this file (${attempt.error}).`,
      });
    }
    if (attempt?.output) warnings.push(...attempt.output.warnings);

    // 4. Reconcile. A deterministic parse that does not add up is also a
    //    reason to try the model.
    let reconciliation = parsed ? reconcile(parsed) : null;

    let llmFailure: string | null = null;
    if ((parsed === null || !reconciliation?.ok) && this.llm.isAvailable) {
      try {
        const result = await this.llm.extractStatement(text, {
          issuer: parserInput.detection.issuer,
          accountType: parserInput.detection.accountType,
        });
        const llmReconciliation = reconcile(result.statement);
        // Only take the model's answer if it is at least as good as ours.
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
        llmFailure = describeLlmFailure(error);
        warnings.push({ code: 'llm_failed', message: llmFailure });
      }
    }

    if (!parsed || !reconciliation) {
      throw ApiException.badRequest(
        unparseableReason(parserInput.detection, this.llm.isAvailable, llmFailure),
      );
    }

    // 5. Categorise: the user's rules, the issuer's column, our rules, then the
    //    model for whatever is left.
    const local = categoriseLocally(parsed.transactions, {
      userRules: await this.rules.listAsMap(input.userId),
    });
    let categories = local.categories;
    const unresolved = local.unresolvedMerchants;

    if (unresolved.length > 0 && this.llm.isAvailable) {
      try {
        const result = await this.llm.categoriseMerchants(unresolved);
        categories = applyLlmCategories(parsed.transactions, categories, result.assignments);
        llmUsage ??= result.usage;
      } catch {
        warnings.push({
          code: 'llm_categorise_failed',
          message: `${unresolved.length} merchant(s) could not be categorised and were left as Uncategorised.`,
        });
      }
    } else if (unresolved.length > 0) {
      warnings.push({
        code: 'uncategorised',
        message: `${unresolved.length} merchant(s) had no matching rule and were left as Uncategorised.`,
      });
    }

    if (parsed.accountType === 'credit_card' && !checkCashback(parsed).ok) {
      warnings.push({
        code: 'cashback_mismatch',
        message:
          'The per-transaction cashback column does not add up to the cashback the statement states. ' +
          'That is usually the issuer capping it, and both figures are kept.',
      });
    }

    // 6. Write. Replace, never add: a re-parse of the same month must not
    //    double up.
    const now = new Date().toISOString();
    const account = mergeAccount(
      await this.accounts.get(
        input.userId,
        accountIdFor(parsed.account.issuer, parsed.account.type, parsed.account.last4),
      ),
      parsed.account,
      now,
    );
    await this.accounts.put(input.userId, account);

    const period = periodForStatement(parsed.periodEnd);
    const statementId = statementIdFor(account.accountId, period);
    const status: StatementStatus = reconciliation.ok ? 'parsed' : 'needs_review';
    const replacing = await this.statements.get(input.userId, statementId);

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
      uploadedAt: now,
    });

    const transactions = parsed.transactions.map((txn, index) =>
      buildTransaction(txn, {
        accountId: account.accountId,
        statementId,
        seq: index,
        category: categories[index]?.category ?? 'Uncategorised',
        categorySource: categories[index]?.source ?? 'rule',
      }),
    );

    await this.transactions.replaceForStatement(input.userId, statementId, transactions);
    await this.statements.put(input.userId, statement);
    if (!replacing) await this.users.bumpStatementCount(input.userId, 1);
    await this.summaries.recompute(input.userId, [period], account.accountId);

    this.log.info('statement.ingested', {
      user: userIdLogPrefix(input.userId),
      parser: parserName,
      accountType: statement.accountType,
      rows: transactions.length,
      status,
      reconciled: reconciliation.ok,
      replaced: replacing !== null,
      provider: llmUsage?.provider,
      modelId: llmUsage?.modelId,
      inputTokens: llmUsage?.inputTokens,
      outputTokens: llmUsage?.outputTokens,
      durationMs: Date.now() - started,
    });

    return { statement, account, transactions, warnings, duplicate: false };
  }

  private async duplicateOf(userId: string, existing: Statement): Promise<ParsedStatementResult> {
    const account =
      (await this.accounts.get(userId, existing.accountId)) ?? placeholderAccount(existing);
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
}

/** Should not happen, but a statement without its account is recoverable. */
function placeholderAccount(statement: Statement): Account {
  const last4 = statement.accountId.slice(-4);
  return {
    accountId: statement.accountId,
    type: statement.accountType,
    issuer: '',
    productName: '',
    displayName: statement.accountId,
    last4,
    maskedNumber: `XXXX${last4}`,
    creditLimitMinor: null,
    cashLimitMinor: null,
    openedAt: null,
    createdAt: statement.uploadedAt,
  };
}

/**
 * Why the model did not read this statement, in the user's terms.
 *
 * The two limit failures are worded differently because what to *do* about
 * them differs: a rate limit clears on its own; a request that is too large
 * never will, and "try again shortly" would waste someone's afternoon.
 */
function describeLlmFailure(error: unknown): string {
  if (error instanceof LlmRateLimitError) {
    return (
      `${error.providerId} is over its rate limit. Upload this again in a minute — ` +
      'one statement can cost more than a minute of a free tier’s token budget.'
    );
  }
  if (error instanceof LlmRequestTooLargeError) {
    return (
      `This statement is larger than ${error.providerId} allows this account in one request, ` +
      'so waiting will not help. Raise the limit with the provider, or point LLM_PROVIDER at ' +
      'one with more room — docs/setup.md lists the alternatives.'
    );
  }
  return `The model could not extract this statement (${
    error instanceof Error ? error.name : 'unknown error'
  }).`;
}

/**
 * Why an upload could not be turned into figures. Three different failures
 * used to share one sentence, and it named the rarest: someone whose provider
 * was fine but rate limited was told none was configured.
 */
function unparseableReason(
  detection: Detection,
  hasProvider: boolean,
  llmFailure: string | null,
): string {
  if (detection.parserId !== null) return 'The statement could not be parsed.';
  const unrecognised = `No built-in parser covers this statement (${detection.reason}).`;
  if (llmFailure !== null) return `${unrecognised} ${llmFailure}`;
  if (hasProvider) return `${unrecognised} The model could not read it either.`;
  return (
    `${unrecognised} Set LLM_PROVIDER and its API key in backend/.env to have a model read ` +
    'the statements no parser covers — docs/setup.md says where each value comes from.'
  );
}
