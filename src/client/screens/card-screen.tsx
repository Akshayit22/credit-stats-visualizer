'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatMinor, formatPct } from '@/shared/money';
import type { Account, CreditCardStatement, Period, Statement, Summary, Transaction } from '@/shared/types';
import { CategoryDonut } from '@/client/charts/category-donut';
import { ChartBlock, useMounted } from '@/client/charts/chart-frame';
import { chartTheme, seriesColor } from '@/client/charts/theme';
import { TrendChart } from '@/client/charts/trend-chart';
import { AppHeader, type PeriodMode } from '@/client/components/app-header';
import { Icon } from '@/client/components/icon';
import { StatTile, TileRow } from '@/client/components/stat-tile';
import { TransactionsTable } from '@/client/components/transactions-table';
import { UploadDialog } from '@/client/components/upload-dialog';
import { formatDayLabel, formatPeriodLabel, formatPeriodRange, formatPeriodShort } from '@/client/lib/format';

export interface CardScreenProps {
  account: Account;
  accounts: Account[];
  statement: CreditCardStatement | null;
  statements: Statement[];
  transactions: Transaction[];
  summaries: Summary[];
  availablePeriods: Period[];
  periodsWithData: Period[];
  selectedPeriod: Period;
  mode: PeriodMode;
}

export function CardScreen(props: CardScreenProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const missing = props.availablePeriods
    .filter((period) => !props.periodsWithData.includes(period))
    .map(formatPeriodLabel);

  const header = (
    <AppHeader
      accounts={props.accounts}
      availablePeriods={props.availablePeriods}
      periodsWithData={props.periodsWithData}
      selectedPeriod={props.selectedPeriod}
      mode={props.mode}
      accountScope="credit_card"
      selectedAccountId={props.account.accountId}
      coverage={{
        have: props.periodsWithData.length,
        total: props.availablePeriods.length,
        missing,
      }}
    />
  );

  if (props.mode === 'year') {
    return (
      <>
        {header}
        <main className="app-main">
          <section className="section">
            <PageHead
              account={props.account}
              title={`Calendar ${props.selectedPeriod.slice(0, 4)}`}
              sub={`${props.periodsWithData.length} of ${props.availablePeriods.length} cycles uploaded`}
            />
            <YearView
              periods={props.availablePeriods}
              summaries={props.summaries}
              withData={props.periodsWithData}
            />
          </section>
        </main>
      </>
    );
  }

  if (!props.statement) {
    return (
      <>
        {header}
        <main className="app-main">
          <section className="section">
            <PageHead
              account={props.account}
              title={formatPeriodLabel(props.selectedPeriod)}
              sub={props.account.maskedNumber}
            />
            <div className="empty-state">
              <Icon.CalendarX size={26} style={{ color: 'var(--color-accent)', opacity: 0.75 }} />
              <p className="empty-title">
                Nothing uploaded for {formatPeriodLabel(props.selectedPeriod)}
              </p>
              <p className="empty-body">
                Upload the statement PDF for this cycle and the charts fill in.
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
          </section>
        </main>
        <UploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          periodHint={formatPeriodLabel(props.selectedPeriod)}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <main className="app-main">
        <CardMonth
          account={props.account}
          statement={props.statement}
          transactions={props.transactions}
          categoryFilter={categoryFilter}
          onCategory={setCategoryFilter}
        />
      </main>
    </>
  );
}

function PageHead({ account, title, sub }: { account: Account; title: string; sub: string }) {
  return (
    <div className="page-head">
      <div>
        <div className="page-kicker">{account.displayName}</div>
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="page-sub">{sub}</div>
    </div>
  );
}

function CardMonth({
  account,
  statement,
  transactions,
  categoryFilter,
  onCategory,
}: {
  account: Account;
  statement: CreditCardStatement;
  transactions: Transaction[];
  categoryFilter: string | null;
  onCategory: (category: string | null) => void;
}) {
  const mounted = useMounted();
  const theme = mounted ? chartTheme() : null;
  const card = statement.card;

  const purchases = useMemo(
    () => transactions.filter((txn) => txn.direction === 'debit' && !txn.isPayment),
    [transactions],
  );
  const fees = useMemo(() => transactions.filter((txn) => txn.isFee), [transactions]);

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const txn of purchases) {
      totals.set(txn.category, (totals.get(txn.category) ?? 0) + txn.amountMinor);
    }
    return [...totals.entries()]
      .map(([name, amountMinor]) => ({ name, amountMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor);
  }, [purchases]);

  const categoryTotal = categories.reduce((total, entry) => total + entry.amountMinor, 0);

  const daily = useMemo(() => buildDailySpend(statement, purchases), [statement, purchases]);
  const peak = [...daily].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];

  return (
    <section className="section">
      <PageHead
        account={account}
        title={formatPeriodLabel(statement.period)}
        sub={`${formatPeriodRange(statement.periodStart, statement.periodEnd)} · ${statement.parser.startsWith('deterministic') ? 'parsed statement' : statement.parser}`}
      />

      {statement.reconciliation.ok ? (
        <p className="reconciled">
          <Icon.Check size={14} aria-hidden="true" />
          Totals reconciled
          <span className="is-muted"> · {statement.reconciliation.message}</span>
        </p>
      ) : (
        <div className="banner" role="alert">
          <Icon.Warning size={16} aria-hidden="true" />
          <span className="banner-body">{statement.reconciliation.message}</span>
        </div>
      )}

      <TileRow>
        <StatTile
          label="Bill"
          value={formatMinor(card.purchasesMinor + card.otherDebitsMinor)}
          note="purchases and charges"
        />
        <StatTile
          label="Cashback"
          value={formatMinor(card.cashbackEarnedMinor)}
          tone="positive"
          note={
            card.purchasesMinor > 0
              ? `${formatPct((card.cashbackEarnedMinor / card.purchasesMinor) * 100, 2)} of spend`
              : undefined
          }
        />
        <StatTile
          label="Fees & interest"
          value={card.otherDebitsMinor > 0 ? formatMinor(card.otherDebitsMinor) : 'None'}
          tone={card.otherDebitsMinor > 0 ? 'warning' : 'positive'}
          note={card.otherDebitsMinor > 0 ? `${fees.length} charges` : 'nothing charged'}
        />
        <StatTile label="Payments" value={formatMinor(card.paymentsMinor, 0)} note="received this cycle" />
        <StatTile
          label="Total due"
          value={formatMinor(card.totalDueMinor)}
          note={`${formatMinor(card.creditLimitMinor, 0)} limit · ${formatPct(card.utilisationPct)} used`}
        />
      </TileRow>

      <ChartBlock
        title="Spend through the cycle"
        subtitle={formatPeriodRange(statement.periodStart, statement.periodEnd)}
        markColor={theme ? seriesColor(theme, 'primary') : undefined}
        height={220}
        stats={
          peak && peak.spend
            ? [{ label: 'Peak', value: `${peak.label} \u00b7 ${formatMinor(peak.spend, 0)}` }]
            : undefined
        }
      >
        <TrendChart
          data={daily}
          series={[{ key: 'spend', name: 'Spend', role: 'primary', area: true }]}
          emptyMessage="nothing spent"
        />
      </ChartBlock>

      <div className="split">
        <ChartBlock
          title="Where it went"
          subtitle={`${categories.length} categories \u00b7 click one to filter the table`}
          height="auto"
        >
          <CategoryDonut
            slices={categories}
            total={categoryTotal}
            selected={categoryFilter}
            onSelect={onCategory}
          />
        </ChartBlock>

        <section className="block">
          <div className="block-head">
            <h3 className="block-title">Fees & charges</h3>
            <span className={`block-sub ${fees.length > 0 ? 'is-warning' : 'is-muted'}`}>
              {fees.length > 0
                ? formatMinor(fees.reduce((total, fee) => total + fee.amountMinor, 0))
                : 'None'}
            </span>
          </div>
          {fees.length > 0 ? (
            <div>
              {fees.map((fee) => (
                <div key={fee.txnId} className="fee-row">
                  <span style={{ flex: 1, fontSize: 12.5 }}>{fee.merchant}</span>
                  <span className="is-muted" style={{ fontSize: 11 }}>
                    {formatDayLabel(fee.date)}
                  </span>
                  <span className="is-warning" style={{ width: 88, textAlign: 'right', fontSize: 12.5 }}>
                    {formatMinor(fee.amountMinor)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="fee-none">
              <Icon.Check size={15} className="is-positive" aria-hidden="true" />
              Nothing charged this cycle.
            </p>
          )}
        </section>
      </div>

      <TransactionsTable
        transactions={transactions}
        variant="credit_card"
        filters={['all', 'purchases', 'charges', 'money']}
        categoryFilter={categoryFilter}
        onClearCategory={() => onCategory(null)}
      />

      <p className="page-sub">
        <Link href={`/accounts/${account.accountId}/cashback?period=${statement.period}`}>
          See cashback in detail →
        </Link>
      </p>
    </section>
  );
}

function YearView({
  periods,
  summaries,
  withData,
}: {
  periods: Period[];
  summaries: Summary[];
  withData: Period[];
}) {
  const mounted = useMounted();
  const theme = mounted ? chartTheme() : null;
  const byPeriod = new Map(summaries.map((summary) => [summary.period, summary]));

  const data = periods.map((period) => {
    const summary = byPeriod.get(period);
    const has = withData.includes(period);
    return {
      label: formatPeriodShort(period),
      spend: has ? (summary?.spendMinor ?? 0) : null,
      cashback: has ? (summary?.cashbackEarnedMinor ?? 0) : null,
      fees: has ? (summary?.feesMinor ?? 0) : null,
    };
  });

  const totals = (key: 'spend' | 'cashback' | 'fees') =>
    data.reduce((sum, point) => sum + (point[key] ?? 0), 0);
  const count = withData.length || 1;

  const lastWithData = [...periods].reverse().find((period) => withData.includes(period));
  const closing = lastWithData ? (byPeriod.get(lastWithData)?.closingBalanceMinor ?? 0) : 0;

  return (
    <>
      {(
        [
          { key: 'spend', title: 'Bill by month', role: 'primary' },
          { key: 'cashback', title: 'Cashback', role: 'good' },
          { key: 'fees', title: 'Fees & interest', role: 'cost' },
        ] as const
      ).map((block) => (
        <ChartBlock
          key={block.key}
          title={block.title}
          subtitle="per statement cycle"
          markColor={theme ? seriesColor(theme, block.role) : undefined}
          height={180}
          stats={[
            { label: 'Total', value: formatMinor(totals(block.key), 0) },
            { label: 'Average', value: formatMinor(Math.round(totals(block.key) / count), 0) },
          ]}
        >
          <TrendChart
            data={data}
            series={[{ key: block.key, name: block.title, role: block.role, area: true }]}
          />
        </ChartBlock>
      ))}

      <section className="block">
        <div className="block-head">
          <h3 className="block-title">Month by month</h3>
        </div>
        <div className="table-scroll">
          <table className="table" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Month</th>
                <th className="num">Spend</th>
                <th className="num">Cashback</th>
                <th className="num">Fees &amp; interest</th>
                <th className="num">Payments</th>
                <th className="num">Closing</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => {
                const summary = byPeriod.get(period);
                const has = withData.includes(period);
                return (
                  <tr key={period} data-empty={!has}>
                    <td style={{ fontSize: 12.5 }}>{formatPeriodLabel(period)}</td>
                    <td className="num">{has ? formatMinor(summary?.spendMinor ?? 0) : 'no statement'}</td>
                    <td className={`num ${has ? 'is-positive' : 'is-muted'}`}>
                      {has ? formatMinor(summary?.cashbackEarnedMinor ?? 0) : '—'}
                    </td>
                    <td className={`num ${has && (summary?.feesMinor ?? 0) > 0 ? 'is-warning' : 'is-muted'}`}>
                      {has && (summary?.feesMinor ?? 0) > 0 ? formatMinor(summary?.feesMinor ?? 0) : '—'}
                    </td>
                    <td className="num">{has ? formatMinor(summary?.paymentsMinor ?? 0) : '—'}</td>
                    <td className="num">
                      {has ? formatMinor(summary?.closingBalanceMinor ?? 0) : '—'}
                    </td>
                  </tr>
                );
              })}
              <tr className="total-row">
                <td style={{ fontSize: 12.5 }}>
                  Total{withData.length < periods.length ? '*' : ''}
                </td>
                <td className="num">{formatMinor(totals('spend'), 0)}</td>
                <td className="num is-positive">{formatMinor(totals('cashback'), 0)}</td>
                <td className="num is-warning">{formatMinor(totals('fees'), 0)}</td>
                <td className="num">
                  {formatMinor(
                    summaries.reduce((total, summary) => total + summary.paymentsMinor, 0),
                    0,
                  )}
                </td>
                <td className="num">{formatMinor(closing, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {withData.length < periods.length && (
          <p className="is-warning" style={{ fontSize: 11.5, margin: 0 }}>
            * Built from {withData.length} of {periods.length} months. Shaded rows have no statement
            uploaded.
          </p>
        )}
      </section>
    </>
  );
}

/** One point per day of the cycle, so a quiet week reads as a flat line. */
function buildDailySpend(
  statement: CreditCardStatement,
  purchases: Transaction[],
): Array<{ label: string; spend: number }> {
  const byDate = new Map<string, number>();
  for (const txn of purchases) {
    byDate.set(txn.date, (byDate.get(txn.date) ?? 0) + txn.amountMinor);
  }

  const out: Array<{ label: string; spend: number }> = [];
  const start = new Date(`${statement.periodStart}T00:00:00Z`);
  const end = new Date(`${statement.periodEnd}T00:00:00Z`);
  for (let day = start; day <= end; day = new Date(day.getTime() + 86_400_000)) {
    const date = day.toISOString().slice(0, 10);
    out.push({ label: formatDayLabel(date), spend: byDate.get(date) ?? 0 });
    if (out.length > 120) break;
  }
  return out;
}
