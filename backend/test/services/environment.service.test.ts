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

  it('refuses to start production without a session secret', () => {
    expect(() => Environment.parse({ MONGODB_URI: 'mongodb://x', NODE_ENV: 'production' })).toThrow(
      /CRED_STATS_SESSION_SECRET/,
    );
  });

  it('refuses a session secret too short to be one', () => {
    expect(() =>
      Environment.parse({ MONGODB_URI: 'mongodb://x', CRED_STATS_SESSION_SECRET: 'short' }),
    ).toThrow(/CRED_STATS_SESSION_SECRET/);
  });
});

describe('the demo sign-in switch', () => {
  function environmentFor(vars: Record<string, string>): Environment {
    const saved = { ...process.env };
    Object.assign(process.env, { MONGODB_URI: 'mongodb://x', ...vars });
    try {
      return new Environment();
    } finally {
      process.env = saved;
    }
  }

  it('is off unless asked for', () => {
    expect(environmentFor({ CRED_STATS_DEV_LOGIN: 'false' }).devLoginEnabled).toBe(false);
  });

  it('is refused in production whatever the flag says', () => {
    const env = environmentFor({
      CRED_STATS_DEV_LOGIN: 'true',
      NODE_ENV: 'production',
      CRED_STATS_SESSION_SECRET: 's'.repeat(40),
    });
    expect(env.devLoginEnabled).toBe(false);
  });
});
