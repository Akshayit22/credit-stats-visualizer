import { Injectable } from '@nestjs/common';
import { redactForLlm, type Category, type LlmUsage, type ProviderInfo } from '@cred-stats/shared';
import type { z } from 'zod';
import {
  MERCHANT_CATEGORIES_JSON_SCHEMA,
  PARSED_STATEMENT_JSON_SCHEMA,
  merchantCategoriesSchema,
  parsedStatementSchema,
  type ParsedStatement,
} from '../domain/schemas.js';
import { extractValidated, type ValidatedExtraction } from '../llm/extract.js';
import {
  CATEGORISE_SYSTEM,
  EXTRACT_SYSTEM,
  categoriseUserPrompt,
  extractUserPrompt,
} from '../llm/prompts.js';
import { estimateOutputTokens, type ExtractJsonArgs } from '../llm/provider.js';
import { LlmClientManager } from '../managers/llm-client.manager.js';
import { LogService } from './log.service.js';

export interface StatementHint {
  issuer: string;
  accountType: string;
}

/**
 * What the ingest pipeline asks of a model: read a statement no parser
 * covers, or name the category of merchants no rule matched.
 *
 * This is the one place statement text becomes a prompt, and so the only place
 * the second redaction pass (`redactForLlm`) is applied. What gets logged is
 * the provider, model, schema, token counts and duration — never a prompt,
 * never a response.
 */
@Injectable()
export class LlmService {
  constructor(
    private readonly client: LlmClientManager,
    private readonly log: LogService,
  ) {}

  /** False when the selected provider is not configured. */
  get isAvailable(): boolean {
    return this.client.provider !== null;
  }

  async extractStatement(
    text: string,
    hint: StatementHint,
  ): Promise<{ statement: ParsedStatement; usage: LlmUsage }> {
    const safeText = redactForLlm(text);
    const result = await this.run(parsedStatementSchema, {
      system: EXTRACT_SYSTEM,
      user: extractUserPrompt(safeText, hint),
      jsonSchema: PARSED_STATEMENT_JSON_SCHEMA,
      schemaName: 'parsed-statement',
      // Sized to this statement. A flat 16,000 made every sizeable upload a
      // permanent 413 on a free tier, because providers charge the requested
      // output against the budget whether the model uses it or not.
      maxTokens: estimateOutputTokens(safeText),
    });
    return { statement: result.data, usage: result.usage };
  }

  async categoriseMerchants(
    merchants: string[],
  ): Promise<{ assignments: Array<{ merchant: string; category: Category }>; usage: LlmUsage }> {
    const result = await this.run(merchantCategoriesSchema, {
      system: CATEGORISE_SYSTEM,
      user: categoriseUserPrompt(merchants.map((merchant) => redactForLlm(merchant))),
      jsonSchema: MERCHANT_CATEGORIES_JSON_SCHEMA,
      schemaName: 'merchant-categories',
      maxTokens: 2_000,
    });
    return { assignments: result.data.assignments, usage: result.usage };
  }

  /** What the settings screen shows. Read-only, and never the key itself. */
  describeProvider(): ProviderInfo {
    const { providerId, modelId, missing } = this.client;
    const configured = missing.length === 0;
    return {
      id: providerId,
      modelId,
      configured,
      missing,
      note:
        providerId === 'mock'
          ? 'No model is being called. The built-in bank parsers handle the statements they cover; anything else is reported as unparsed rather than guessed.'
          : configured
            ? 'Used only when no built-in parser covers a statement, when a parse does not reconcile, or to categorise a merchant no rule matched. Prompts are redacted first: no name, address, phone, email, customer id, account number or reference id reaches the provider.'
            : 'This provider is selected but not configured, so the app behaves as if no model were available. docs/setup.md says where each value comes from.',
    };
  }

  private async run<S extends z.ZodType>(
    schema: S,
    args: ExtractJsonArgs,
  ): Promise<ValidatedExtraction<z.output<S>>> {
    const provider = this.client.provider;
    if (!provider) throw new Error('No AI provider is configured.');

    const started = Date.now();
    const fields = {
      provider: provider.id,
      modelId: provider.modelId,
      schema: args.schemaName ?? 'unnamed',
    };
    try {
      const result = await extractValidated(provider, schema, args);
      this.log.info('llm.extract', {
        ...fields,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        retried: result.attempts > 1,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      this.log.warn('llm.extract.failed', {
        ...fields,
        error: error instanceof Error ? error.name : 'unknown',
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }
}
