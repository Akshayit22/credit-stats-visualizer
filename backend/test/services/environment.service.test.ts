import { describe, expect, it } from 'vitest';
import { Environment } from '../../src/services/environment.service.js';

describe('Environment', () => {
  it('applies the defaults', () => {
    const env = Environment.parse({ MONGODB_URI: 'mongodb://localhost:27017' });
    expect(env.PORT).toBe(4000);
    expect(env.MONGODB_DB).toBe('cred-stats');
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.NODE_ENV).toBe('development');
  });

  it('names the variable that is missing', () => {
    expect(() => Environment.parse({})).toThrow(/MONGODB_URI/);
  });

  it('never echoes the value that failed', () => {
    let message = '';
    try {
      Environment.parse({ MONGODB_URI: 'mongodb://x', LLM_PROVIDER: 'gsk_secret_key_pasted_here' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/LLM_PROVIDER/);
    expect(message).not.toMatch(/gsk_secret/);
  });
});
