import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parserInputFor } from '@/server/parsing/registry';
import type { ParserInput } from '@/server/parsing/types';

export const FIXTURE_NAMES = {
  card: 'axis-supermoney-card-jun',
  sliceJul: 'slice-account-statement-jul',
  sliceAug: 'slice-account-statement-aug',
  /** IDFC prints the date and time in one cell on the money row. */
  idfcOct: 'idfc-statement-oct-25',
  /** The same bank, splitting that column across the lines above and below. */
  idfcDec: 'idfc-statement-dec-25',
} as const;

export function fixtureText(name: string): string {
  return readFileSync(resolve('fixtures', `${name}.txt`), 'utf8');
}

export function fixtureMeta(name: string): { pageCount: number; contentHash: string } {
  return JSON.parse(readFileSync(resolve('fixtures', `${name}.meta.json`), 'utf8'));
}

export function fixtureInput(name: string): ParserInput {
  return parserInputFor(fixtureText(name));
}
