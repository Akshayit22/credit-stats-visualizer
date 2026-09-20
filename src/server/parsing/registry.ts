import { toLines } from '@/shared/statement-text';
import { detectStatement } from './detect';
import { axisSupermoneyCardParser } from './parsers/axis-supermoney-card';
import { idfcSavingsParser } from './parsers/idfc-savings';
import { sliceSavingsParser } from './parsers/slice-savings';
import type { ParserInput, ParserOutput, StatementParser } from './types';

/**
 * Deterministic parsers, keyed by the fingerprint id they answer to. Adding a
 * bank is: a fingerprint in `detect.ts`, a parser file, and one line here.
 */
const PARSERS: readonly StatementParser[] = [
  sliceSavingsParser,
  axisSupermoneyCardParser,
  idfcSavingsParser,
];

export function getParser(id: string | null): StatementParser | null {
  if (id === null) return null;
  return PARSERS.find((parser) => parser.id === id) ?? null;
}

export function parserInputFor(text: string): ParserInput {
  const detection = detectStatement(text);
  return { text, lines: toLines(text), detection };
}

export interface DeterministicAttempt {
  parserId: string;
  output: ParserOutput | null;
  error: string | null;
}

/**
 * Runs the deterministic parser the detector chose, if there is one. Never
 * throws: a parser that blows up is a fallback signal, not a request failure.
 */
export function runDeterministicParser(input: ParserInput): DeterministicAttempt | null {
  const parser = getParser(input.detection.parserId);
  if (!parser) return null;
  try {
    return { parserId: parser.id, output: parser.parse(input), error: null };
  } catch (error) {
    return {
      parserId: parser.id,
      output: null,
      error: error instanceof Error ? error.message : 'the parser failed',
    };
  }
}

export { detectStatement };
