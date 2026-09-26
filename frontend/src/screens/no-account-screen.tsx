import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/icon';
import { UploadDialog } from '../components/upload-dialog';

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
          <Icon.FilePdf size={26} className="is-accent empty-icon" aria-hidden="true" />
          <p className="empty-body">{body}</p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
              Upload a statement
            </button>
            {otherHref && (
              <Link className="btn btn-secondary" to={otherHref}>
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
