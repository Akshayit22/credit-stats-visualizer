'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMinor } from '@/shared/money';
import type { ParsedStatementResult } from '@/shared/types';
import { Icon } from './icon';
import { ReviewStep } from './review-step';
import {
  EmptyPdfError,
  PdfPasswordRequiredError,
  postStatement,
  prepareUpload,
  type PreparedUpload,
} from '@/client/lib/upload';

type Phase = 'pick' | 'parsing' | 'review' | 'error';

export function UploadDialog({
  open,
  onClose,
  periodHint,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-filled when the dialog is opened from an empty month. */
  periodHint?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordId = useId();

  const [phase, setPhase] = useState<Phase>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedStatementResult | null>(null);
  const [prepared, setPrepared] = useState<PreparedUpload | null>(null);

  const reset = useCallback(() => {
    setPhase('pick');
    setFile(null);
    setPassword('');
    setNeedsPassword(false);
    setError(null);
    setResult(null);
    setPrepared(null);
  }, []);

  const close = useCallback(() => {
    // Refresh on the way out, once, so whatever is behind picks up the upload
    // without shifting while the dialog is still open.
    if (result !== null) router.refresh();
    reset();
    onClose();
  }, [onClose, reset, result, router]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  if (!open) return null;

  const parse = async () => {
    if (!file) return;
    setPhase('parsing');
    setError(null);
    try {
      const preparedUpload = await prepareUpload(file, password || undefined);
      setPrepared(preparedUpload);
      const parsedResult = await postStatement(preparedUpload);
      setResult(parsedResult);
      setPhase('review');
      // Deliberately not refreshing here. The statement is already saved; the
      // page behind the dialog does not need to know until the dialog closes,
      // and refreshing now reflows the library underneath while you are still
      // reading the review step.
    } catch (caught) {
      if (caught instanceof PdfPasswordRequiredError) {
        setNeedsPassword(true);
        setError(caught.message);
        setPhase('pick');
        return;
      }
      setError(
        caught instanceof EmptyPdfError || caught instanceof Error
          ? caught.message
          : 'Something went wrong reading that file.',
      );
      setPhase('error');
    }
  };

  const pick = (chosen: File | null) => {
    if (!chosen) return;
    if (!/\.pdf$/i.test(chosen.name)) {
      setError('That is not a PDF. Statements come as PDFs from your bank.');
      return;
    }
    setFile(chosen);
    setError(null);
    setPhase('pick');
  };

  return (
    <div className="dialog-backdrop" style={{ zIndex: 90 }} onMouseDown={close}>
      <div
        className="dialog"
        style={{ width: 'min(560px, 100%)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
          <div style={{ flex: 1 }}>
            <h2 className="dialog-title" id="upload-title">
              {phase === 'review' ? 'Check the figures' : 'Upload statement'}
            </h2>
            <p className="dropzone-hint" style={{ margin: '3px 0 0' }}>
              {phase === 'review'
                ? 'Nothing is saved to your dashboards until you keep it.'
                : periodHint
                  ? `Card and savings statements both work · ${periodHint}`
                  : 'Card and savings statements both work.'}
            </p>
          </div>
          <button type="button" className="dialog-close" onClick={close} aria-label="Close">
            <Icon.X size={16} />
          </button>
        </div>

        {phase === 'review' && result ? (
          <ReviewStep result={result} redacted={prepared?.redacted ?? {}} onDone={close} />
        ) : (
          <>
            <button
              type="button"
              className="dropzone"
              data-dragging={dragging}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                pick(event.dataTransfer.files[0] ?? null);
              }}
            >
              <Icon.FilePdf size={24} style={{ color: 'var(--color-accent)' }} aria-hidden="true" />
              <span className="dropzone-title">
                {file ? file.name : 'Drop statement PDFs, or browse'}
              </span>
              <span className="dropzone-hint">
                Card and savings statements both work. Password-protected files supported.
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="visually-hidden"
              onChange={(event) => pick(event.target.files?.[0] ?? null)}
            />

            <div className="field">
              <label htmlFor={passwordId}>
                PDF password, if set
                {needsPassword && (
                  <span className="is-warning"> — this file needs one</span>
                )}
              </label>
              <input
                id={passwordId}
                className="input"
                type="password"
                placeholder="••••••••"
                value={password}
                autoComplete="off"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && file) void parse();
                }}
              />
              <p className="dropzone-hint" style={{ marginTop: 'var(--space-2)' }}>
                The password unlocks the file in this browser and is never sent anywhere.
              </p>
            </div>

            {error && (
              <div className="banner" data-tone="negative" role="alert">
                <Icon.Warning size={16} aria-hidden="true" />
                <span className="banner-body">{error}</span>
              </div>
            )}

            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void parse()}
                disabled={!file || phase === 'parsing'}
              >
                {phase === 'parsing' ? 'Parsing…' : 'Parse'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function formatDifference(amountMinor: number): string {
  return formatMinor(Math.abs(amountMinor));
}
