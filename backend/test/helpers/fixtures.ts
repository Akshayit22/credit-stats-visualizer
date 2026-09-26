import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parserInputFor } from '../../src/parsing/registry.js';
import type { ParserInput } from '../../src/parsing/types.js';

/**
 * The committed fixtures: **redacted** text extracted from the author's own
 * real statements. `npm run fixtures:build -w @cred-stats/backend` regenerates
 * them from the PDFs in `samples/`, which is gitignored and must stay that way.
 */
export const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export const FIXTURE_NAMES = {
  card: 'axis-supermoney-card-jun',
  sliceJul: 'slice-account-statement-jul',
  sliceAug: 'slice-account-statement-aug',
} as const;

export function fixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.txt'));
}

export function fixtureText(name: string): string {
  return readFileSync(new URL(`${name}.txt`, `file://${FIXTURES_DIR}`), 'utf8');
}

export function fixtureMeta(name: string): { pageCount: number; contentHash: string } {
  return JSON.parse(
    readFileSync(new URL(`${name}.meta.json`, `file://${FIXTURES_DIR}`), 'utf8'),
  ) as { pageCount: number; contentHash: string };
}

export function fixtureInput(name: string): ParserInput {
  return parserInputFor(fixtureText(name));
}
