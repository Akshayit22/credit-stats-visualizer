import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_ENV } from '@/server/llm/factory';
import { TABLE_KINDS } from '@/server/db/table-names';
import { allTableDefinitions } from '@/server/db/table-definitions';

/**
 * Documentation drifts silently. These are the few claims about configuration
 * and infrastructure that are cheap to check and expensive to get wrong.
 */

const envExample = readFileSync(resolve('.env.example'), 'utf8');
const documented = new Set(
  envExample
    .split('\n')
    .map((line) => line.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1])
    .filter((name): name is string => name !== undefined),
);

describe('.env.example', () => {
  it('documents every variable a provider needs', () => {
    const required = [...new Set(Object.values(REQUIRED_ENV).flat())];
    const undocumented = required.filter((name) => !documented.has(name));
    expect(undocumented).toEqual([]);
  });

  it('documents the variables the app itself reads', () => {
    for (const name of [
      'AUTH_SECRET',
      'NEXTAUTH_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'CRED_STATS_DEV_LOGIN',
      'DDB_ENDPOINT',
      'DDB_TABLE_PREFIX',
      'AWS_REGION',
      'LLM_PROVIDER',
    ]) {
      expect(documented.has(name), `${name} is missing from .env.example`).toBe(true);
    }
  });

  it('carries no value for anything secret', () => {
    // The example file travels; a real key in it would be committed.
    for (const line of envExample.split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, name, value] = match;
      if (name === undefined || value === undefined) continue;
      if (!/(KEY|SECRET|TOKEN|PASSWORD)/.test(name)) continue;
      // `local` is the dummy DynamoDB Local credential and is not a secret.
      expect(value.trim() === '' || value.trim() === 'local').toBe(true);
    }
  });

  it('points at DynamoDB Local by default, so a fresh clone runs offline', () => {
    expect(envExample).toMatch(/^DDB_ENDPOINT=http:\/\/localhost:8000$/m);
    expect(envExample).toMatch(/^DDB_TABLE_PREFIX=cred-stats-local$/m);
    expect(envExample).toMatch(/^LLM_PROVIDER=mock$/m);
    expect(envExample).toMatch(/^AWS_REGION=ap-south-1$/m);
  });
});

describe('the five tables', () => {
  it('are five, and are the five named in the design', () => {
    expect(TABLE_KINDS).toEqual(['users', 'accounts', 'statements', 'transactions', 'summaries']);
    expect(allTableDefinitions()).toHaveLength(5);
  });

  it('all key on pk/sk and bill on demand', () => {
    for (const definition of allTableDefinitions()) {
      expect(definition.BillingMode).toBe('PAY_PER_REQUEST');
      expect(definition.KeySchema).toEqual([
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ]);
    }
  });

  it('give statements and transactions the two indexes the screens query', () => {
    const withIndexes = allTableDefinitions().filter(
      (definition) => (definition.GlobalSecondaryIndexes ?? []).length > 0,
    );
    expect(withIndexes.map((definition) => definition.TableName)).toEqual([
      'cred-stats-local-statements',
      'cred-stats-local-transactions',
    ]);
    for (const definition of withIndexes) {
      expect((definition.GlobalSecondaryIndexes ?? []).map((index) => index.IndexName)).toEqual([
        'gsi1',
        'gsi2',
      ]);
    }
  });
});
