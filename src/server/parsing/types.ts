import type { StatementLine } from '@/shared/statement-text';
import type { ParsedStatement } from '@/server/domain/schemas';
import type { ParseWarning } from '@/shared/types';
import type { Detection } from './detect';

export interface ParserInput {
  /** Redacted, normalised statement text. */
  text: string;
  /** The same text pre-split into lines and columns. */
  lines: StatementLine[];
  detection: Detection;
}

export interface ParserOutput {
  statement: ParsedStatement;
  warnings: ParseWarning[];
}

/**
 * A deterministic parser for one bank's statement layout.
 *
 * It may throw. It may also produce something that fails reconciliation. Either
 * way the pipeline falls back to the LLM, so a parser should be written to be
 * precise rather than forgiving: guessing quietly is worse than failing.
 */
export interface StatementParser {
  id: string;
  parse(input: ParserInput): ParserOutput;
}

export class ParseError extends Error {
  readonly parserId: string;
  constructor(parserId: string, message: string) {
    super(message);
    this.name = 'ParseError';
    this.parserId = parserId;
  }
}
