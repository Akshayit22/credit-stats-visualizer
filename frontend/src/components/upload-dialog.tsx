import type { ParsedStatementResult } from '@cred-stats/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { refreshData } from '../hooks/queries';
import { ApiError } from '../services/api-client';
import { endpoints } from '../services/endpoints';
import { EmptyPdfError, PdfPasswordRequiredError, prepareUpload } from '../utils/upload';
import { Icon } from './icon';
import { ReviewStep } from './review-step';

type Phase = 'pick' | 'parsing' | 'review' | 'error';

/**
 * Pick a PDF, unlock it if it needs a password, parse it — then review.
 *
 * The file is read, decrypted and redacted in this browser; only the text is
 * posted. The statement is saved as soon as the API has parsed it, and the
 * review step is where a wrong category gets fixed.
 */
export function UploadDialog({
  open,
  onClose,
  periodHint,
}: {
  open: boolean;
  onClose: () => void;
  /** Named in the subtitle when the dialog is opened from a particular month. */
  periodHint?: string;
}) {
  const client = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordId = useId();
  const titleId = useId();

  const [phase, setPhase] = useState<Phase>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedStatementResult | null>(null);
  const [redacted, setRedacted] = useState<Record<string, number>>({});

  const close = useCallback(() => {
    // Refresh on the way out, once, so the screen behind picks up the upload
    // without reflowing while the review step is still being read.
    if (result !== null) void refreshData(client);
    setPhase('pick');
    setFile(null);
    setPassword('');
    setNeedsPassword(false);
    setError(null);
    setResult(null);
    setRedacted({});
    onClose();
  }, [client, onClose, result]);

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
      const prepared = await prepareUpload(file, password || undefined);
      setRedacted(prepared.redacted);
      setResult(await endpoints.statements.upload(prepared.payload));
      setPhase('review');
    } catch (caught) {
      if (caught instanceof PdfPasswordRequiredError) {
        setNeedsPassword(true);
        setError(caught.message);
        setPhase('pick');
        return;
      }
      setError(
        caught instanceof ApiError || caught instanceof EmptyPdfError
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
    <div className="dialog-backdrop is-upload" onMouseDown={close}>
      <div
        className="dialog is-upload"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div className="dialog-head-text">
            <h2 className="dialog-title" id={titleId}>
              {phase === 'review' ? 'Check the figures' : 'Upload statement'}
            </h2>
            <p className="dropzone-hint dialog-subtitle">
              {phase === 'review'
                ? 'Saved. A category fixed here sticks for that merchant from now on.'
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
          <ReviewStep result={result} redacted={redacted} onDone={close} />
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
              <Icon.FilePdf size={24} className="is-accent" aria-hidden="true" />
              <span className="dropzone-title">
                {file ? file.name : 'Drop a statement PDF, or browse'}
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
              data-testid="statement-file"
              onChange={(event) => pick(event.target.files?.[0] ?? null)}
            />

            <div className="field">
              <label htmlFor={passwordId}>
                PDF password, if set
                {needsPassword && <span className="is-warning"> — this file needs one</span>}
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
              <p className="dropzone-hint field-hint">
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
