import { itemsToLines, type StatementPage, type TextItemLike } from '@cred-stats/shared';

/**
 * Turning a PDF into the canonical statement text, in the browser only.
 *
 * The bytes never leave this module and the password never leaves the browser
 * at all: pdf.js decrypts in its worker, we read the positioned text items,
 * and the `ArrayBuffer` goes out of scope. Nothing is uploaded but text.
 */

export class PdfPasswordRequiredError extends Error {
  readonly wrongPassword: boolean;
  constructor(wrongPassword: boolean) {
    super(wrongPassword ? 'That password did not open the PDF.' : 'This PDF needs a password.');
    this.name = 'PdfPasswordRequiredError';
    this.wrongPassword = wrongPassword;
  }
}

/**
 * Loads pdf.js lazily, so the library and its worker are only fetched when
 * someone actually uploads. Vite bundles the worker from the same package
 * version, so the two can never drift apart.
 */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
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

  const loadingTask = pdfjs.getDocument({
    // pdf.js transfers and then detaches the buffer, so hand it a copy —
    // otherwise a retry with a corrected password gets an empty buffer.
    data: new Uint8Array(data.slice(0)),
    password,
    useSystemFonts: true,
    // No `isEvalSupported: false` any more: pdf.js 6 removed eval entirely.
  });

  let document;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      const code = (error as { code?: number }).code;
      throw new PdfPasswordRequiredError(code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
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
      items.push({
        str: item.str,
        x: Number(item.transform[4] ?? 0),
        y: Number(item.transform[5] ?? 0),
        width: Number(item.width),
      });
    }
    pages.push({ pageNumber, lines: itemsToLines(items) });
    page.cleanup();
  }

  await loadingTask.destroy();
  return { pages, pageCount: pages.length };
}

/**
 * sha256 of the redacted, normalised text. Taken in the browser so the hash
 * never depends on anything that was stripped, and so re-uploading the same
 * file is recognised before any of it is parsed again.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
