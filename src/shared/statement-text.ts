import { stripInvisible } from './money';

/**
 * The canonical form a statement travels in.
 *
 * The browser does not flatten a PDF into a blob of words — column structure is
 * what makes a deterministic parser possible. It reconstructs each printed line
 * from the text items' x/y positions and joins the cells with a TAB, then marks
 * each page with `@@PAGE n`. The result is still plain text: redaction stays a
 * regex pass, the LLM fallback still gets something readable, and nothing but
 * text ever leaves the browser.
 *
 *   @@PAGE 1
 *   01 Aug '26<TAB>Interest Cr. for 31-Jul-2026<TAB>2022621364474<TAB>₹39.69<TAB>₹2,75,978.06
 */

export const PAGE_MARKER = '@@PAGE';
export const CELL = '\t';

export interface StatementPage {
  pageNumber: number;
  lines: string[];
}

/** One printed line, already split into its columns. */
export interface StatementLine {
  pageNumber: number;
  /** 0-based index within the page. */
  index: number;
  cells: string[];
  /** The cells joined by a single space — handy for fingerprinting. */
  text: string;
}

export function formatStatementText(pages: StatementPage[]): string {
  return pages
    .map((page) => [`${PAGE_MARKER} ${page.pageNumber}`, ...page.lines].join('\n'))
    .join('\n');
}

export function parseStatementText(text: string): StatementPage[] {
  const pages: StatementPage[] = [];
  let current: StatementPage | null = null;

  for (const rawLine of text.split('\n')) {
    const marker = rawLine.match(/^@@PAGE\s+(\d+)\s*$/);
    if (marker) {
      current = { pageNumber: Number(marker[1]), lines: [] };
      pages.push(current);
      continue;
    }
    if (rawLine.trim().length === 0) continue;
    if (!current) {
      // Text with no page marker at all: treat the whole thing as page 1.
      current = { pageNumber: 1, lines: [] };
      pages.push(current);
    }
    current.lines.push(rawLine);
  }
  return pages;
}

/** Every line across every page, flattened, with its page and index attached. */
export function toLines(text: string): StatementLine[] {
  const out: StatementLine[] = [];
  for (const page of parseStatementText(text)) {
    page.lines.forEach((line, index) => {
      const cells = line.split(CELL).map((cell) => cell.trim());
      out.push({
        pageNumber: page.pageNumber,
        index,
        cells,
        text: cells.filter((cell) => cell.length > 0).join(' '),
      });
    });
  }
  return out;
}

/**
 * The normalisation every reader applies before doing anything else. Runs in the
 * browser before hashing, and again on the server, so the same bytes always
 * produce the same `contentHash`.
 *
 * - invisible characters go (slice hides a zero-width space inside `idfcfirst`)
 * - curly quotes and dashes become their ASCII forms
 * - runs of spaces collapse, but TABs — the column separator — are preserved
 * - trailing whitespace and blank lines go
 */
export function normaliseStatementText(text: string): string {
  const lines = stripInvisible(text.replace(/\r\n?/g, '\n'))
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .split('\n');

  const out: string[] = [];
  for (const line of lines) {
    const cleaned = line
      .split(CELL)
      .map((cell) => cell.replace(/ {2,}/g, ' ').trim())
      .join(CELL)
      .replace(/\t+$/, '');
    if (cleaned.trim().length > 0) out.push(cleaned);
  }
  return out.join('\n');
}

/** Lower-cased, whitespace-collapsed, tabs flattened — for fingerprint matching. */
export function fingerprintHaystack(text: string): string {
  return text.replace(/\t/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}
