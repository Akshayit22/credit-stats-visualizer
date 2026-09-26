import { Injectable } from '@nestjs/common';
import type { LlmProvider, ProviderId } from '../llm/provider.js';
import { buildProvider, configuredModelId, missingSettings } from '../llm/provider-factory.js';
import { Environment } from '../services/environment.service.js';
import { LogService } from '../services/log.service.js';

/**
 * Owns the AI provider client, built once from the environment.
 *
 * An incomplete configuration is not a boot failure — the built-in parsers
 * still work without a model — so the client is simply absent, and the
 * settings screen says which variables are missing.
 */
@Injectable()
export class LlmClientManager {
  readonly providerId: ProviderId;
  readonly modelId: string;
  /** Names of the settings the selected provider still needs. */
  readonly missing: string[];
  /** Null when the selected provider is not fully configured. */
  readonly provider: LlmProvider | null;

  constructor(environment: Environment, log: LogService) {
    const { env } = environment;
    this.providerId = env.LLM_PROVIDER;
    this.modelId = configuredModelId(env);
    this.missing = missingSettings(env);
    this.provider = this.missing.length === 0 ? buildProvider(env) : null;

    if (this.provider === null) {
      log.warn('llm.not_configured', {
        provider: this.providerId,
        missing: this.missing.join(','),
      });
    }
  }
}
