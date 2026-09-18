'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORIES } from '@/shared/categories';
import { formatMinor } from '@/shared/money';
import type { Category } from '@/shared/categories';
import type { ParsedStatementResult, Transaction } from '@/shared/types';
import { Icon } from './icon';

/**
 * The step between parsing and trusting the numbers. It shows what reconciled,
 * what was removed, and the rows whose category we are least sure of — those
 * are the ones worth a human glance, and fixing one here writes a rule so the
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
  const router = useRouter();
  const { statement, account, transactions, warnings, duplicate } = result;
  const [edits, setEdits] = useState<Record<string, Category>>({});
  const [saving, setSaving] = useState(false);

  const removedCount = Object.values(redacted).reduce((total, n) => total + n, 0);
  const reconciled = statement.reconciliation?.ok ?? false;

  // Worth checking: anything Uncategorised, anything a model guessed, and the
  // largest few rows — a wrong big number matters more than a wrong small one.
  const worthChecking = [...transactions]
    .map((txn, index) => ({ txn, index }))
    .filter(
      ({ txn }) =>
        txn.category === 'Uncategorised' || txn.categorySource === 'llm' || txn.amountMinor > 0,
    )
    .sort((a, b) => rank(b.txn) - rank(a.txn))
    .slice(0, 8);

  const save = async () => {
    setSaving(true);
    try {
      for (const [txnId, category] of Object.entries(edits)) {
        const txn = transactions.find((candidate) => candidate.txnId === txnId);
        if (!txn) continue;
        await fetch('/api/transactions', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            txnId: txn.txnId,
            date: txn.date,
            accountId: txn.accountId,
            category,
            applyToMerchant: true,
          }),
        });
      }
      router.refresh();
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {duplicate ? (
        <div className="banner" role="status">
          <Icon.Check size={16} aria-hidden="true" />
          <span className="banner-body">
            Already uploaded. This is the statement that was saved the first time — nothing was
            added.
          </span>
        </div>
      ) : reconciled ? (
        <div className="banner" data-tone="positive" role="status" style={bannerPositive}>
          <Icon.Check size={16} aria-hidden="true" />
          <span className="banner-body">
            Totals reconciled. {statement.reconciliation.message}
          </span>
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
          <div className="block-head" style={{ marginBottom: 'var(--space-2)' }}>
            <span className="block-title">Worth a glance</span>
            <span className="block-sub">a change here applies to this merchant from now on</span>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 86 }}>Date</th>
                  <th>Details</th>
                  <th className="num" style={{ width: 104 }}>
                    Amount
                  </th>
                  <th style={{ width: 168 }}>Category</th>
                </tr>
              </thead>
              <tbody>
                {worthChecking.map(({ txn }) => (
                  <tr key={txn.txnId}>
                    <td className="cell-dim">{txn.date.slice(8)}/{txn.date.slice(5, 7)}</td>
                    <td style={{ fontSize: 13 }}>{txn.merchant || txn.descriptionRaw}</td>
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
                        className="input"
                        style={{ fontSize: 12 }}
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

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={saving}>
          Close
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving
            ? 'Saving…'
            : Object.keys(edits).length > 0
              ? `Keep with ${Object.keys(edits).length} change${Object.keys(edits).length === 1 ? '' : 's'}`
              : 'Looks right'}
        </button>
      </div>
    </div>
  );
}

const bannerPositive: React.CSSProperties = {
  color: 'var(--color-positive)',
  background: 'color-mix(in srgb, var(--color-positive) 10%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-positive) 30%, transparent)',
};

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
