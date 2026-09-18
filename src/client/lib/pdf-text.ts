import type { StatementPage } from '@/shared/statement-text';

/**
 * Turning a PDF into the canonical statement text, in the browser only.
 *
 * The bytes never leave this module and the password never leaves the browser
 * at all: `getDocument` decrypts in the worker, we read the text items, and the
 * `ArrayBuffer` goes out of scope. Nothing is uploaded but the text.
 */

/** Two items further apart than this horizontally are in different columns. */
const COLUMN_GAP = 2.5;
/** Two items within this many points vertically are on the same printed line. */
const LINE_TOLERANCE = 2;

export interface TextItemLike {
  str: string;
  x: number;
  y: number;
  width: number;
}

export class PdfPasswordRequiredError extends Error {
  readonly wrongPassword: boolean;
  constructor(wrongPassword: boolean) {
    super(wrongPassword ? 'That password did not open the PDF.' : 'This PDF needs a password.');
    this.name = 'PdfPasswordRequiredError';
    this.wrongPassword = wrongPassword;
  }
}

/**
 * Groups text items into printed lines and printed lines into columns.
 * Exported on its own so it can be tested without a PDF, and so the fixture
 * builder can reuse the exact algorithm the browser runs.
 */
export function itemsToLines(items: TextItemLike[]): string[] {
  const kept = items.filter((item) => item.str.trim().length > 0);

  const rows: Array<{ y: number; items: TextItemLike[] }> = [];
  for (const item of kept) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= LINE_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    const ordered = [...row.items].sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd: number | null = null;
    for (const item of ordered) {
      if (previousEnd !== null && item.x - previousEnd > COLUMN_GAP) text += '\t';
      text += item.str;
      previousEnd = item.x + item.width;
    }
    return text.replace(/[ \t]+$/, '');
  });
}

/**
 * Loads pdf.js lazily so the worker and the 1MB+ library are only fetched when
 * someone actually opens the upload dialog.
 */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  // The worker is copied into public/ by the postinstall step; its version must
  // match the library exactly or pdf.js refuses to start.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return pdfjs;
}

export interface ExtractResult {
  pages: StatementPage[];
  pageCount: number;
}

export async function extractPdfPages(
  data: ArrayBuffer,
  password?: string,
): Promise<ExtractResult> {
  const pdfjs = await loadPdfjs();

  let document;
  try {
    document = await pdfjs.getDocument({
      // pdf.js transfers and then detaches the buffer, so hand it a copy —
      // otherwise a retry with a corrected password gets an empty buffer.
      data: new Uint8Array(data.slice(0)),
      password,
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const code = (error as { code?: number } | null)?.code;
    if (name === 'PasswordException') {
      // pdf.js code 1 is "need a password", code 2 is "that one was wrong".
      throw new PdfPasswordRequiredError(code === 2);
    }
    throw error;
  }

  const pages: StatementPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: TextItemLike[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const transform = item.transform;
      items.push({
        str: item.str,
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0),
        width: Number(item.width ?? 0),
      });
    }
    pages.push({ pageNumber, lines: itemsToLines(items) });
    page.cleanup();
  }

  await document.destroy();
  return { pages, pageCount: pages.length };
}

/**
 * sha256 of the redacted, normalised text. Taken in the browser so the hash
 * never depends on anything we stripped, and so re-uploading the same file is
 * recognised before any of it is parsed again.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
