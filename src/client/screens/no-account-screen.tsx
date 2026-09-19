'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/client/components/icon';
import { UploadDialog } from '@/client/components/upload-dialog';

/**
 * What a section shows when the user has no account of that type yet. It is a
 * real screen rather than a redirect to Overview, because landing somewhere
 * unexpected after clicking "Credit card" reads as a bug.
 */
export function NoAccountScreen({
  kicker,
  title,
  body,
  otherHref,
  otherLabel,
}: {
  kicker: string;
  title: string;
  body: string;
  otherHref: string | null;
  otherLabel: string;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <main className="app-main">
      <section className="section">
        <div className="page-head">
          <div>
            <div className="page-kicker">{kicker}</div>
            <h1 className="page-title">{title}</h1>
          </div>
        </div>

        <div className="empty-state">
          <Icon.FilePdf size={26} style={{ color: 'var(--color-accent)', opacity: 0.75 }} />
          <p className="empty-body">{body}</p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 4, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
              Upload a statement
            </button>
            {otherHref && (
              <Link className="btn btn-secondary" href={otherHref}>
                {otherLabel}
              </Link>
            )}
          </div>
        </div>
      </section>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </main>
  );
}
