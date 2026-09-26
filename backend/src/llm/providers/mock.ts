import type { ExtractJsonArgs, LlmProvider, LlmUsage } from '../provider.js';

/**
 * The provider that needs no key.
 *
 * It is what `npm run dev:nollm` runs on and what the tests use, so the whole
 * pipeline — including the fallback path — is exercisable with no account
 * anywhere. It does not pretend to read the statement: it returns whatever
 * fixture the caller registered, and refuses loudly if there is none, because a
 * mock that quietly invents plausible figures is worse than no mock at all.
 */

export type MockHandler = (args: ExtractJsonArgs) => unknown;

const handlers = new Map<string, MockHandler>();

/**
 * Registers the answer for one schema. `schemaName` is what the caller passes
 * on `extractJson`, so a test can answer the statement schema and the
 * categories schema differently.
 */
export function setMockResponse(schemaName: string, handler: MockHandler | unknown): void {
  handlers.set(schemaName, typeof handler === 'function' ? (handler as MockHandler) : () => handler);
}

export function clearMockResponses(): void {
  handlers.clear();
}

export class MockNotConfiguredError extends Error {
  constructor(schemaName: string) {
    super(
      `The mock provider has no fixture for "${schemaName}". ` +
        `Call setMockResponse(${JSON.stringify(schemaName)}, …) first, or configure a real provider.`,
    );
    this.name = 'MockNotConfiguredError';
  }
}

export function mockProvider(): LlmProvider {
  return {
    id: 'mock',
    modelId: 'mock-fixture',
    extractJson<T>(args: ExtractJsonArgs): Promise<{ data: T; usage: LlmUsage }> {
      const name = args.schemaName ?? 'default';
      const handler = handlers.get(name);
      if (!handler) return Promise.reject(new MockNotConfiguredError(name));
      return Promise.resolve({
        data: handler(args) as T,
        // Realistic enough that the usage fields on a statement are exercised.
        usage: { inputTokens: Math.ceil(args.user.length / 4), outputTokens: 256 },
      });
    },
  };
}
