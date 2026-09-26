import { describe, expect, it } from 'vitest';
import type { ExtractJsonArgs, LlmProvider } from '../../src/llm/provider.js';
import type { LlmClientManager } from '../../src/managers/llm-client.manager.js';
import type { LogService } from '../../src/services/log.service.js';
import { LlmService } from '../../src/services/llm.service.js';

const silentLog = { info: () => {}, warn: () => {} } as unknown as LogService;

function recordingProvider(reply: unknown): LlmProvider & { calls: ExtractJsonArgs[] } {
  const calls: ExtractJsonArgs[] = [];
  return {
    id: 'groq',
    modelId: 'test-model',
    calls,
    extractJson<T>(args: ExtractJsonArgs) {
      calls.push(args);
      return Promise.resolve({ data: reply as T, usage: { inputTokens: 7, outputTokens: 3 } });
    },
  };
}

function serviceWith(client: Partial<LlmClientManager>): LlmService {
  return new LlmService(client as LlmClientManager, silentLog);
}

describe('LlmService', () => {
  it('redacts again before the text becomes a prompt', async () => {
    const provider = recordingProvider({ assignments: [] });
    const service = serviceWith({ provider, providerId: 'groq', modelId: 'm', missing: [] });

    await service.categoriseMerchants(['REF 2026080414026601 SWIGGY']);

    const prompt = provider.calls[0]?.user ?? '';
    expect(prompt).toContain('SWIGGY');
    expect(prompt).not.toContain('2026080414026601');
  });

  it('reports the usage it was charged', async () => {
    const provider = recordingProvider({
      assignments: [{ merchant: 'Swiggy', category: 'Food & dining' }],
    });
    const service = serviceWith({ provider, providerId: 'groq', modelId: 'm', missing: [] });

    const result = await service.categoriseMerchants(['Swiggy']);
    expect(result.assignments).toEqual([{ merchant: 'Swiggy', category: 'Food & dining' }]);
    expect(result.usage).toEqual({
      provider: 'groq',
      modelId: 'test-model',
      inputTokens: 7,
      outputTokens: 3,
    });
  });

  it('is unavailable, and says what is missing, when not configured', () => {
    const service = serviceWith({
      provider: null,
      providerId: 'groq',
      modelId: 'openai/gpt-oss-120b',
      missing: ['GROQ_API_KEY'],
    });
    expect(service.isAvailable).toBe(false);
    expect(service.describeProvider()).toMatchObject({
      id: 'groq',
      configured: false,
      missing: ['GROQ_API_KEY'],
    });
  });

  it('never puts a key in what the settings screen shows', () => {
    const service = serviceWith({
      provider: recordingProvider({}),
      providerId: 'groq',
      modelId: 'openai/gpt-oss-120b',
      missing: [],
    });
    expect(JSON.stringify(service.describeProvider())).not.toMatch(/gsk_/);
  });
});
