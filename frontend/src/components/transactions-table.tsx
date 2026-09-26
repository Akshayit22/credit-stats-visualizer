import { useMemo, useState } from 'react';
import { CATEGORIES, type Category, formatMinor, type Transaction, formatDayShort } from '@cred-stats/shared';
import { useRecategorise } from '../hooks/queries';
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
  const recategoriseRow = useRecategorise();
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

  const recategorise = (txn: Transaction, category: Category) => {
    setEditing(null);
    recategoriseRow.mutate({
      statementId: txn.statementId,
      txnId: txn.txnId,
      change: { category, applyToMerchant: true },
    });
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
        <table className="table is-transactions" data-variant={variant}>
          <caption className="visually-hidden">
            Every transaction in this period, with its category and amount.
          </caption>
          <thead>
            <tr>
              <th className="col-date">Date</th>
              <th>Details</th>
              <th className={variant === 'savings' ? 'col-mode' : 'col-category'}>
                {variant === 'savings' ? 'Mode' : 'Category'}
              </th>
              <th className="num col-amount">Amount</th>
              <th className="num col-balance">
                {variant === 'savings' ? 'Balance' : 'Cashback'}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="cell-dim cell-empty">
                  Nothing matches that filter.
                </td>
              </tr>
            )}
            {shown.map((txn) => (
              <tr key={`${txn.date}-${txn.accountId}-${txn.txnId}`}>
                <td className="cell-dim">{formatDayShort(txn.date)}</td>
                <td className="cell-merchant">{txn.merchant || txn.descriptionRaw}</td>
                <td className="cell-meta is-muted">
                  {variant === 'savings' ? (
                    MODE_LABEL[txn.mode]
                  ) : editing === txn.txnId ? (
                    <>
                      <label className="visually-hidden" htmlFor={`recat-${txn.txnId}`}>
                        Category for {txn.merchant || 'this transaction'}
                      </label>
                      <select
                        id={`recat-${txn.txnId}`}
                        className="input is-compact"
                        defaultValue={txn.category}
                        autoFocus
                        onBlur={() => setEditing(null)}
                        onChange={(event) =>
                          recategorise(txn, event.target.value as Category)
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
                <td className="num cell-small">
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
        <p className="block-sub is-flush">
          {interestRows.length} daily interest credits are folded away —{' '}
          {formatMinor(interestTotal)} in total.{' '}
          <button type="button" className="btn btn-ghost" onClick={() => setShowInterest(true)}>
            Show them
          </button>
        </p>
      )}
      {variant === 'savings' && showInterest && (
        <p className="block-sub is-flush">
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
