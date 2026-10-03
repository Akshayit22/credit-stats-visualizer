import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { environmentSchema } from '../src/environment.js';
import { REQUIRED_SETTINGS } from '../src/llm/provider-factory.js';

/**
 * Documentation drifts silently. These are the few claims about configuration
 * that are cheap to check and expensive to get wrong.
 */

const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const documented = new Set(
  envExample
    .split('\n')
    .map((line) => line.match(/^#?\s*([A-Z_][A-Z0-9_]*)=/)?.[1])
    .filter((name): name is string => name !== undefined),
);

describe('backend/.env.example', () => {
  it('documents every variable the API reads', () => {
    const undocumented = Object.keys(environmentSchema.shape).filter(
      (name) => !documented.has(name),
    );
    expect(undocumented).toEqual([]);
  });

  it('documents every setting a provider needs', () => {
    const required = [...new Set(Object.values(REQUIRED_SETTINGS).flat())];
    expect(required.filter((name) => !documented.has(name))).toEqual([]);
  });

  it('carries no value for anything secret', () => {
    // The example file is committed; a real key in it would be too.
    for (const line of envExample.split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, name, value] = match;
      if (name === undefined || value === undefined) continue;
      if (!/(KEY|SECRET|TOKEN|PASSWORD)/.test(name)) continue;
      expect(value.trim(), `${name} must be blank in the example`).toBe('');
    }
  });

  it('runs a fresh clone offline: local MongoDB, no model', () => {
    expect(envExample).toMatch(/^MONGODB_URI=mongodb:\/\/localhost:27018$/m);
    expect(envExample).toMatch(/^LLM_PROVIDER=mock$/m);
  });
});
