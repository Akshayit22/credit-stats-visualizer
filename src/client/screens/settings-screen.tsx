'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/client/components/icon';

export interface ProviderInfo {
  id: string;
  modelId: string;
  configured: boolean;
  /** What is missing, when it is not configured. */
  missing: string[];
  note: string;
}

export function SettingsScreen({
  email,
  currency,
  locale,
  statementCount,
  accountCount,
  provider,
}: {
  email: string;
  currency: string;
  locale: string;
  statementCount: number;
  accountCount: number;
  provider: ProviderInfo;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteEverything = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete my data' }),
      });
      if (!response.ok) throw new Error('Your data could not be deleted.');
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-main">
      <section className="section" style={{ gap: 'calc(var(--space-8) * 1.15)' }}>
        <div className="page-head">
          <div>
            <div className="page-kicker">Settings</div>
            <h1 className="page-title">Your account</h1>
          </div>
        </div>

        <section className="block">
          <div className="block-head">
            <h2 className="block-title">Account</h2>
          </div>
          <dl className="settings-list">
            <Row label="Signed in as" value={email} />
            <Row label="Currency" value={currency} />
            <Row label="Locale" value={locale} />
            <Row
              label="Held for you"
              value={`${statementCount} statement${statementCount === 1 ? '' : 's'} across ${accountCount} account${accountCount === 1 ? '' : 's'}`}
            />
          </dl>
        </section>

        <section className="block">
          <div className="block-head">
            <h2 className="block-title">AI provider</h2>
            <span className="block-sub">read-only — set in the environment, not here</span>
          </div>
          <dl className="settings-list">
            <Row label="Provider" value={provider.id} />
            <Row label="Model" value={provider.modelId || 'not set'} />
            <Row
              label="Status"
              value={provider.configured ? 'configured' : `missing ${provider.missing.join(', ')}`}
              tone={provider.configured ? 'is-positive' : 'is-warning'}
            />
          </dl>
          <p className="settings-note">{provider.note}</p>
        </section>

        <section className="block">
          <div className="block-head">
            <h2 className="block-title">What is kept</h2>
          </div>
          <p className="settings-note">
            Statement PDFs are unlocked and read in your browser and then discarded. The password
            never leaves your browser. Only the extracted figures are stored, with account numbers
            reduced to their last four digits, and the holder&rsquo;s name, address, phone, email
            and customer id removed before anything is saved.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <a className="btn btn-secondary" href="/api/account/export" download>
              Export everything as JSON
            </a>
            {confirming ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: 'var(--color-negative)', borderColor: 'var(--color-negative)' }}
                  disabled={busy}
                  onClick={() => void deleteEverything()}
                >
                  {busy ? 'Deleting…' : 'Yes, delete all my data'}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
                Delete all my data
              </button>
            )}
          </div>
          {confirming && (
            <p className="banner" data-tone="negative" role="alert">
              <Icon.Warning size={16} aria-hidden="true" />
              <span className="banner-body">
                This removes every account, statement, transaction and summary across all five
                tables. It cannot be undone.
              </span>
            </p>
          )}
          {error && (
            <div className="banner" data-tone="negative" role="alert">
              <span className="banner-body">{error}</span>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="settings-row">
      <dt className="tile-label">{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  );
}
