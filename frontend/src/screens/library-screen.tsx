import {
  formatPeriodRange,
  type Account,
  type Statement,
  type StatementStatus,
} from '@cred-stats/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { DeleteAllData } from '../components/delete-all-data';
import { Icon } from '../components/icon';
import { UploadDialog } from '../components/upload-dialog';
import { useDeleteStatement } from '../hooks/queries';
import { ApiError } from '../services/api-client';
import { endpoints } from '../services/endpoints';

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

/** Every statement uploaded, newest first, with a way into each and out of all. */
export function LibraryScreen({
  statements,
  accounts,
}: {
  statements: Statement[];
  accounts: Account[];
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const removeStatement = useDeleteStatement();
  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  const deleting = removeStatement.isPending ? removeStatement.variables : null;

  return (
    <main className="app-main">
      <section className="section is-compact">
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

        {removeStatement.error && (
          <div className="banner" data-tone="negative" role="alert">
            <Icon.Warning size={16} aria-hidden="true" />
            <span className="banner-body">
              {removeStatement.error instanceof ApiError
                ? removeStatement.error.message
                : 'That statement could not be deleted.'}
            </span>
          </div>
        )}

        {statements.length === 0 ? (
          <div className="empty-state">
            <Icon.Files size={26} className="is-accent empty-icon" aria-hidden="true" />
            <p className="empty-title">Nothing uploaded yet</p>
            <p className="empty-body">
              Upload a credit card or savings statement PDF and the dashboards fill in. Password
              protected files are fine.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
              Upload statement
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table is-library">
              <caption className="visually-hidden">Every statement uploaded, newest first.</caption>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="col-period">Period</th>
                  <th className="col-uploaded">Uploaded</th>
                  <th className="num col-rows">Rows</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {statements.map((statement) => {
                  const account = byId.get(statement.accountId);
                  const base = statement.accountType === 'savings' ? '/savings' : '/accounts';
                  return (
                    <tr key={statement.statementId}>
                      <td>
                        <div className="cell-merchant">
                          {account?.issuer ?? statement.accountId}
                        </div>
                        <div className="cell-sub">
                          {account
                            ? `${account.productName || 'Account'} ${account.last4}`
                            : statement.accountType}
                        </div>
                      </td>
                      <td className="cell-small">
                        {formatPeriodRange(statement.periodStart, statement.periodEnd)}
                      </td>
                      <td className="cell-dim">{statement.uploadedAt.slice(0, 10)}</td>
                      <td className="num cell-small">{statement.rowCount}</td>
                      <td>
                        <span className="badge" data-tone={STATUS_TONE[statement.status]}>
                          {STATUS_LABEL[statement.status]}
                        </span>
                      </td>
                      <td className="num">
                        <Link
                          to={`${base}/${statement.accountId}?period=${statement.period}`}
                          className="btn btn-ghost is-small"
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          className="btn btn-ghost is-small is-danger"
                          disabled={deleting === statement.statementId}
                          onClick={() => removeStatement.mutate(statement.statementId)}
                        >
                          {deleting === statement.statementId ? '…' : 'Delete'}
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
          <a className="btn btn-secondary" href={endpoints.profile.exportUrl} download>
            Export data
          </a>
          <DeleteAllData />
        </div>
      </section>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </main>
  );
}
