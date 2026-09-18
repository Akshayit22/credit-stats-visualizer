'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORIES, type Category } from '@/shared/categories';
import { formatMinor } from '@/shared/money';
import type { Transaction } from '@/shared/types';
import { formatDayShort } from '@/client/lib/format';
import { Icon } from './icon';

export type TxnFilter = 'all' | 'purchases' | 'charges' | 'money' | 'in' | 'out' | 'interest';
export type SortKey = 'date' | 'amount';

/**
 * The transactions table, shared by the card and savings screens. It also
 * stands in as the **table view** the charts above it rely on: every figure a
 * chart shows is readable here as text, so nothing is gated behind colour or a
 * hover.
 *
 * Savings statements credit interest almost every day. Forty of those rows bury
 * the four transfers that actually happened, so they are folded into one line
 * by default, with a toggle to expand.
 */
export function TransactionsTable({
  transactions,
  variant,
  filters,
  categoryFilter,
  onClearCategory,
}: {
  transactions: Transaction[];
  variant: 'credit_card' | 'savings';
  filters: TxnFilter[];
  categoryFilter?: string | null;
  onClearCategory?: () => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<TxnFilter>(filters[0] ?? 'all');
  const [sort, setSort] = useState<SortKey>('date');
  const [showInterest, setShowInterest] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const interestRows = useMemo(
    () => transactions.filter((txn) => txn.isInterest),
    [transactions],
  );

  const shown = useMemo(() => {
    let rows = transactions.filter((txn) => matches(txn, filter));
    if (categoryFilter) rows = rows.filter((txn) => txn.category === categoryFilter);
    if (variant === 'savings' && !showInterest && filter !== 'interest') {
      rows = rows.filter((txn) => !txn.isInterest);
    }
    return [...rows].sort((a, b) =>
      sort === 'amount'
        ? b.amountMinor - a.amountMinor
        : a.date === b.date
          ? a.seq - b.seq
          : b.date.localeCompare(a.date),
    );
  }, [transactions, filter, categoryFilter, variant, showInterest, sort]);

  const interestTotal = interestRows.reduce((total, txn) => total + txn.amountMinor, 0);
  const interestFolded =
    variant === 'savings' && !showInterest && filter !== 'interest' && interestRows.length > 0;

  const recategorise = async (txn: Transaction, category: Category) => {
    setEditing(null);
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
    router.refresh();
  };

  return (
    <section className="block">
      <div className="block-head">
        <div className="block-head-left">
          <h3 className="block-title">Transactions</h3>
          <span className="block-sub">
            {categoryFilter && (
              <button type="button" className="btn btn-ghost" onClick={onClearCategory}>
                {categoryFilter} only <Icon.X size={11} aria-hidden="true" />
              </button>
            )}{' '}
            {shown.length} of {transactions.length}
          </span>
        </div>
        <div className="control-row">
          <div className="seg" role="group" aria-label="Filter transactions">
            {filters.map((option) => (
              <button
                key={option}
                type="button"
                className="seg-btn"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
              >
                {FILTER_LABEL[option]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Sort transactions">
            {(['date', 'amount'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className="seg-btn"
                aria-pressed={sort === key}
                onClick={() => setSort(key)}
              >
                {key === 'date' ? 'Date' : 'Amount'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="table" style={{ minWidth: variant === 'savings' ? 700 : 680 }}>
          <caption className="visually-hidden">
            Every transaction in this period, with its category and amount.
          </caption>
          <thead>
            <tr>
              <th style={{ width: 80 }}>Date</th>
              <th>Details</th>
              <th style={{ width: variant === 'savings' ? 96 : 150 }}>
                {variant === 'savings' ? 'Mode' : 'Category'}
              </th>
              <th className="num" style={{ width: 120 }}>
                Amount
              </th>
              <th className="num" style={{ width: 118 }}>
                {variant === 'savings' ? 'Balance' : 'Cashback'}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="cell-dim" style={{ padding: 'var(--space-6) 2px' }}>
                  Nothing matches that filter.
                </td>
              </tr>
            )}
            {shown.map((txn) => (
              <tr key={`${txn.date}-${txn.accountId}-${txn.txnId}`}>
                <td className="cell-dim">{formatDayShort(txn.date)}</td>
                <td style={{ fontSize: 13 }}>{txn.merchant || txn.descriptionRaw}</td>
                <td style={{ fontSize: 11.5 }} className="is-muted">
                  {variant === 'savings' ? (
                    MODE_LABEL[txn.mode]
                  ) : editing === txn.txnId ? (
                    <>
                      <label className="visually-hidden" htmlFor={`recat-${txn.txnId}`}>
                        Category for {txn.merchant || 'this transaction'}
                      </label>
                      <select
                        id={`recat-${txn.txnId}`}
                        className="input"
                        style={{ fontSize: 11.5 }}
                        defaultValue={txn.category}
                        autoFocus
                        onBlur={() => setEditing(null)}
                        onChange={(event) =>
                          void recategorise(txn, event.target.value as Category)
                        }
                      >
                        {CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="category-chip"
                      onClick={() => setEditing(txn.txnId)}
                      title="Change this category — it will stick for this merchant"
                    >
                      {txn.category}
                      {txn.userEdited && <span aria-label=" (edited by you)"> ·</span>}
                    </button>
                  )}
                </td>
                <td className={`num ${txn.direction === 'credit' ? 'is-positive' : ''}`}>
                  {formatMinor(txn.amountMinor)}
                  <span className="drcr"> {txn.direction === 'credit' ? 'Cr' : 'Dr'}</span>
                </td>
                <td className="num" style={{ fontSize: 12.5 }}>
                  {variant === 'savings' ? (
                    <span className="is-muted">
                      {txn.balanceAfterMinor === null ? '—' : formatMinor(txn.balanceAfterMinor)}
                    </span>
                  ) : txn.cashbackMinor && txn.cashbackMinor > 0 ? (
                    <span className="is-positive">{formatMinor(txn.cashbackMinor)}</span>
                  ) : (
                    <span className="is-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {interestFolded && (
        <p className="block-sub" style={{ margin: 0 }}>
          {interestRows.length} daily interest credits are folded away —{' '}
          {formatMinor(interestTotal)} in total.{' '}
          <button type="button" className="btn btn-ghost" onClick={() => setShowInterest(true)}>
            Show them
          </button>
        </p>
      )}
      {variant === 'savings' && showInterest && (
        <p className="block-sub" style={{ margin: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={() => setShowInterest(false)}>
            Fold the daily interest away again
          </button>
        </p>
      )}
    </section>
  );
}

const FILTER_LABEL: Record<TxnFilter, string> = {
  all: 'All',
  purchases: 'Purchases',
  charges: 'Charges',
  money: 'Payments',
  in: 'In',
  out: 'Out',
  interest: 'Interest',
};

const MODE_LABEL: Record<Transaction['mode'], string> = {
  upi: 'UPI',
  card: 'Card',
  interest: 'Interest',
  fee: 'Fee',
  payment: 'Payment',
  other: 'Transfer',
};

function matches(txn: Transaction, filter: TxnFilter): boolean {
  switch (filter) {
    case 'purchases':
      return txn.direction === 'debit' && !txn.isFee && !txn.isPayment;
    case 'charges':
      return txn.isFee;
    case 'money':
      return txn.isPayment || txn.direction === 'credit';
    case 'in':
      return txn.direction === 'credit' && !txn.isInterest;
    case 'out':
      return txn.direction === 'debit';
    case 'interest':
      return txn.isInterest;
    default:
      return true;
  }
}
