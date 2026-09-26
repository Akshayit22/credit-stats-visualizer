import {
  CATEGORIES,
  formatDayShort,
  formatMinor,
  type Category,
  type ParsedStatementResult,
  type Transaction,
} from '@cred-stats/shared';
import { useState } from 'react';
import { useRecategorise } from '../hooks/queries';
import { ApiError } from '../services/api-client';
import { Icon } from './icon';

/**
 * The step between parsing and trusting the numbers. It shows what
 * reconciled, what was removed, and the rows whose category is least certain —
 * those are worth a human glance, and fixing one here writes a rule so the
 * same merchant is right next month.
 */
export function ReviewStep({
  result,
  redacted,
  onDone,
}: {
  result: ParsedStatementResult;
  redacted: Record<string, number>;
  onDone: () => void;
}) {
  const recategorise = useRecategorise();
  const { statement, account, transactions, warnings, duplicate } = result;
  const [edits, setEdits] = useState<Record<string, Category>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removedCount = Object.values(redacted).reduce((total, n) => total + n, 0);
  const editCount = Object.keys(edits).length;

  // Worth checking: anything Uncategorised, anything a model guessed, and the
  // largest few rows — a wrong big number matters more than a wrong small one.
  const worthChecking = [...transactions].sort((a, b) => rank(b) - rank(a)).slice(0, 8);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const [txnId, category] of Object.entries(edits)) {
        await recategorise.mutateAsync({
          statementId: statement.statementId,
          txnId,
          change: { category, applyToMerchant: true },
        });
      }
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The changes could not be saved.');
      setSaving(false);
    }
  };

  return (
    <div className="review-step">
      {duplicate ? (
        <div className="banner" data-tone="neutral" role="status">
          <Icon.Check size={16} aria-hidden="true" />
          <span className="banner-body">
            Already uploaded. This is the statement that was saved the first time — nothing was
            added.
          </span>
        </div>
      ) : statement.reconciliation.ok ? (
        <div className="banner" data-tone="positive" role="status">
          <Icon.Check size={16} aria-hidden="true" />
          <span className="banner-body">Totals reconciled. {statement.reconciliation.message}</span>
        </div>
      ) : (
        <div className="banner" role="alert">
          <Icon.Warning size={16} aria-hidden="true" />
          <span className="banner-body">{statement.reconciliation.message}</span>
        </div>
      )}

      <dl className="review-facts">
        <Fact label="Account" value={account.displayName} />
        <Fact label="Period" value={`${statement.periodStart} → ${statement.periodEnd}`} />
        <Fact label="Rows" value={String(statement.rowCount)} />
        <Fact
          label={statement.accountType === 'credit_card' ? 'Total due' : 'Closing balance'}
          value={formatMinor(
            statement.accountType === 'credit_card'
              ? statement.card.totalDueMinor
              : statement.savings.closingBalanceMinor,
          )}
        />
        <Fact label="Read by" value={statement.parser.replace('deterministic:', '')} />
        <Fact
          label="Removed before saving"
          value={removedCount > 0 ? `${removedCount} identifiers` : 'nothing to remove'}
        />
      </dl>

      {warnings.length > 0 && (
        <ul className="review-warnings">
          {warnings.map((warning) => (
            <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
          ))}
        </ul>
      )}

      {!duplicate && worthChecking.length > 0 && (
        <div>
          <div className="block-head">
            <span className="block-title">Worth a glance</span>
            <span className="block-sub">a change here applies to this merchant from now on</span>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-date">Date</th>
                  <th>Details</th>
                  <th className="num col-amount">Amount</th>
                  <th className="col-category">Category</th>
                </tr>
              </thead>
              <tbody>
                {worthChecking.map((txn) => (
                  <tr key={txn.txnId}>
                    <td className="cell-dim">{formatDayShort(txn.date)}</td>
                    <td className="review-merchant">{txn.merchant || txn.descriptionRaw}</td>
                    <td className="num">
                      {formatMinor(txn.amountMinor)}
                      <span className="drcr"> {txn.direction === 'credit' ? 'Cr' : 'Dr'}</span>
                    </td>
                    <td>
                      <label className="visually-hidden" htmlFor={`cat-${txn.txnId}`}>
                        Category for {txn.merchant || 'this transaction'}
                      </label>
                      <select
                        id={`cat-${txn.txnId}`}
                        className="input is-compact"
                        value={edits[txn.txnId] ?? txn.category}
                        onChange={(event) =>
                          setEdits((previous) => ({
                            ...previous,
                            [txn.txnId]: event.target.value as Category,
                          }))
                        }
                      >
                        {CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="banner" data-tone="negative" role="alert">
          <Icon.Warning size={16} aria-hidden="true" />
          <span className="banner-body">{error}</span>
        </div>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={saving}>
          Close
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving
            ? 'Saving…'
            : editCount > 0
              ? `Keep with ${editCount} change${editCount === 1 ? '' : 's'}`
              : 'Looks right'}
        </button>
      </div>
    </div>
  );
}

function rank(txn: Transaction): number {
  if (txn.category === 'Uncategorised') return 1_000_000_000 + txn.amountMinor;
  if (txn.categorySource === 'llm') return 500_000_000 + txn.amountMinor;
  return txn.amountMinor;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="tile-label">{label}</dt>
      <dd className="review-fact-value">{value}</dd>
    </div>
  );
}
