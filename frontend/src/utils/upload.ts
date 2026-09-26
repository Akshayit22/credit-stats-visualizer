import {
  formatStatementText,
  normaliseStatementText,
  redactForStorage,
  type StatementUploadPayload,
} from '@cred-stats/shared';
import { PdfPasswordRequiredError, extractPdfPages, sha256Hex } from './pdf-text';

/**
 * The browser half of the parse pipeline:
 *
 *   1. read the file into memory
 *   2. decrypt and extract text with pdf.js — the password stays here
 *   3. redact
 *   4. hash the redacted text
 *
 * What comes out is the request body for `POST /api/statements`: text and a
 * hash. The `ArrayBuffer` is never stored and never sent. Neither is the
 * password.
 */

export interface PreparedUpload {
  payload: StatementUploadPayload;
  /** What redaction removed, by kind — shown in the review step. */
  redacted: Record<string, number>;
}

export class EmptyPdfError extends Error {
  constructor() {
    super(
      'No text could be read from this PDF. Scanned or photographed statements are not supported yet — ' +
        'ask your bank for the original e-statement.',
    );
    this.name = 'EmptyPdfError';
  }
}

export async function prepareUpload(file: File, password?: string): Promise<PreparedUpload> {
  const bytes = await file.arrayBuffer();
  const { pages, pageCount } = await extractPdfPages(bytes, password);

  const raw = normaliseStatementText(formatStatementText(pages));
  const { text, counts } = redactForStorage(raw);

  if (text.replace(/@@PAGE \d+/g, '').trim().length < 40) throw new EmptyPdfError();

  return {
    payload: {
      text,
      // Hashed after redaction, so the hash never depends on anything that was
      // stripped and re-uploading the same file is always recognised.
      contentHash: await sha256Hex(text),
      meta: { pageCount, fileName: file.name, extractedAt: new Date().toISOString() },
    },
    redacted: counts,
  };
}

export { PdfPasswordRequiredError };
