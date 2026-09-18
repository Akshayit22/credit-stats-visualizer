'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Account, Statement, StatementStatus } from '@/shared/types';
import { formatPeriodRange } from '@/client/lib/format';
import { Icon } from '@/client/components/icon';
import { UploadDialog } from '@/client/components/upload-dialog';

const STATUS_TONE: Record<StatementStatus, string> = {
  parsed: 'positive',
  needs_review: 'warning',
  failed: 'negative',
  parsing: 'neutral',
};

const STATUS_LABEL: Record<StatementStatus, string> = {
  parsed: 'parsed',
  needs_review: 'needs review',
  failed: 'failed',
  parsing: 'parsing',
};

export function LibraryScreen({
  statements,
  accounts,
}: {
  statements: Statement[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(accounts.map((account) => [account.accountId, account]));

  const remove = async (statement: Statement) => {
    setBusy(statement.statementId);
    setError(null);
    try {
      const response = await fetch(`/api/statements/${statement.statementId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('That statement could not be deleted.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const deleteEverything = async () => {
    setBusy('all');
    setError(null);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete my data' }),
      });
      if (!response.ok) throw new Error('Your data could not be deleted.');
      setConfirmDeleteAll(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="app-main">
      <section className="section" style={{ gap: 'calc(var(--space-8) * 1.15)' }}>
        <div className="page-head">
          <div>
            <div className="page-kicker">Library</div>
            <h1 className="page-title">Statements</h1>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
            <Icon.Plus size={14} aria-hidden="true" />
            Add statement
          </button>
        </div>

        {error && (
          <div className="banner" data-tone="negative" role="alert">
            <Icon.Warning size={16} aria-hidden="true" />
            <span className="banner-body">{error}</span>
          </div>
        )}

        {statements.length === 0 ? (
          <div className="empty-state">
            <Icon.Files size={26} style={{ color: 'var(--color-accent)', opacity: 0.75 }} />
            <p className="empty-title">Nothing uploaded yet</p>
            <p className="empty-body">
              Upload a credit card or savings statement PDF and the dashboards fill in. Password
              protected files are fine.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 4 }}
              onClick={() => setUploadOpen(true)}
            >
              Upload statement
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th style={{ width: 178 }}>Period</th>
                  <th style={{ width: 120 }}>Uploaded</th>
                  <th className="num" style={{ width: 70 }}>
                    Rows
                  </th>
                  <th style={{ width: 140 }}>Status</th>
                  <th style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {statements.map((statement) => {
                  const account = byId.get(statement.accountId);
                  const href =
                    statement.accountType === 'savings'
                      ? `/savings/${statement.accountId}?period=${statement.period}`
                      : `/accounts/${statement.accountId}?period=${statement.period}`;
                  return (
                    <tr key={statement.statementId}>
                      <td>
                        <div style={{ fontSize: 13 }}>{account?.issuer ?? statement.accountId}</div>
                        <div className="cell-sub">
                          {account
                            ? `${account.productName || 'Account'} ${account.last4}`
                            : statement.accountType}
                        </div>
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {formatPeriodRange(statement.periodStart, statement.periodEnd)}
                      </td>
                      <td className="cell-dim">{statement.uploadedAt.slice(0, 10)}</td>
                      <td className="num" style={{ fontSize: 12.5 }}>
                        {statement.rowCount}
                      </td>
                      <td>
                        <span className="badge" data-tone={STATUS_TONE[statement.status]}>
                          {STATUS_LABEL[statement.status]}
                        </span>
                      </td>
                      <td className="num">
                        <Link href={href} className="btn btn-ghost" style={{ fontSize: 12 }}>
                          View
                        </Link>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 12, color: 'var(--color-negative)' }}
                          disabled={busy === statement.statementId}
                          onClick={() => void remove(statement)}
                        >
                          {busy === statement.statementId ? '…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="footer-note">
          <p>
            PDFs are decrypted and parsed in your browser, then discarded. Only the extracted
            figures are kept.
          </p>
          <a className="btn btn-secondary" href="/api/account/export" download>
            Export data
          </a>
          {confirmDeleteAll ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDeleteAll(false)}
              >
                Keep it
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ color: 'var(--color-negative)', borderColor: 'var(--color-negative)' }}
                disabled={busy === 'all'}
                onClick={() => void deleteEverything()}
              >
                {busy === 'all' ? 'Deleting…' : 'Yes, delete everything'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmDeleteAll(true)}
            >
              Delete all
            </button>
          )}
        </div>
      </section>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </main>
  );
}
