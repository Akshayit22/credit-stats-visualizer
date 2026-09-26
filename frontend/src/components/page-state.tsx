import { ApiError } from '../services/api-client';

/**
 * What a screen shows while its view is loading, or when it could not be
 * loaded. Every page uses these, so waiting and failing look the same
 * everywhere.
 */

export function PageLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <main className="app-main" aria-busy="true">
      <span className="visually-hidden">{label}…</span>
      <div className="skeleton page-skeleton-title" />
      <div className="tile-row">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton page-skeleton-tile" />
        ))}
      </div>
      <div className="skeleton page-skeleton-chart" />
    </main>
  );
}

export function PageError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong loading this page.';

  return (
    <main className="app-main">
      <section className="section">
        <div className="empty-state">
          <p className="empty-title">{notFound ? 'Not found' : 'This page could not be loaded'}</p>
          <p className="empty-body">{message}</p>
          {onRetry && !notFound && (
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
