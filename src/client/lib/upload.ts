import { redactForStorage } from '@/shared/redact';
import { formatStatementText, normaliseStatementText } from '@/shared/statement-text';
import type { ParsedStatementResult } from '@/shared/types';
import { PdfPasswordRequiredError, extractPdfPages, sha256Hex } from './pdf-text';

/**
 * The browser half of the parse pipeline.
 *
 *   1. read the file into memory
 *   2. decrypt and extract text with pdf.js — the password stays here
 *   3. redact
 *   4. hash the redacted text and POST text + hash
 *
 * The `ArrayBuffer` is never stored and never sent. Neither is the password.
 */

export interface PreparedUpload {
  text: string;
  contentHash: string;
  pageCount: number;
  fileName: string;
  /** What redaction removed, by kind — shown in the review step. */
  redacted: Record<string, number>;
}

export async function prepareUpload(file: File, password?: string): Promise<PreparedUpload> {
  const bytes = await file.arrayBuffer();
  const { pages, pageCount } = await extractPdfPages(bytes, password);

  const raw = normaliseStatementText(formatStatementText(pages));
  const { text, counts } = redactForStorage(raw);

  if (text.replace(/@@PAGE \d+/g, '').trim().length < 40) {
    throw new EmptyPdfError();
  }

  return {
    text,
    // Hashed after redaction, so the hash never depends on anything we stripped
    // and re-uploading the same file is always recognised.
    contentHash: await sha256Hex(text),
    pageCount,
    fileName: file.name,
    redacted: counts,
  };
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

export async function postStatement(prepared: PreparedUpload): Promise<ParsedStatementResult> {
  const response = await fetch('/api/statements', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: prepared.text,
      contentHash: prepared.contentHash,
      meta: {
        pageCount: prepared.pageCount,
        fileName: prepared.fileName,
        extractedAt: new Date().toISOString(),
      },
    }),
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: { message?: string } }).error.message ?? 'Upload failed.')
        : 'Upload failed.';
    throw new Error(message);
  }
  return (body as { data: ParsedStatementResult }).data;
}

export { PdfPasswordRequiredError };
