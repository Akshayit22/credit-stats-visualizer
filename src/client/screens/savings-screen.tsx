'use client';

import { useMemo, useState } from 'react';
import { formatMinor } from '@/shared/money';
import type { Account, Period, SavingsStatement, Statement, Summary, Transaction } from '@/shared/types';
import { ChartBlock, useMounted } from '@/client/charts/chart-frame';
import { chartTheme, seriesColor } from '@/client/charts/theme';
import { TrendChart } from '@/client/charts/trend-chart';
import { AppHeader, type PeriodMode } from '@/client/components/app-header';
import { Icon } from '@/client/components/icon';
import { StatTile, TileRow } from '@/client/components/stat-tile';
import { TransactionsTable } from '@/client/components/transactions-table';
import { UploadDialog } from '@/client/components/upload-dialog';
import { accountShortName, formatDayLabel, formatPeriodLabel, formatPeriodRange, formatPeriodShort } from '@/client/lib/format';

export interface SavingsScreenProps {
  account: Account;
  statement: SavingsStatement | null;
  statements: Statement[];
  transactions: Transaction[];
  summaries: Summary[];
  availablePeriods: Period[];
  periodsWithData: Period[];
  selectedPeriod: Period;
  mode: PeriodMode;
}

export function SavingsScreen(props: SavingsScreenProps) {
  const [uploadOpen, setUploadOpen] = useState(false);

  const header = (
    <AppHeader
      title={accountShortName(props.account)}
      availablePeriods={props.availablePeriods}
      periodsWithData={props.periodsWithData}
      selectedPeriod={props.selectedPeriod}
      mode={props.mode}
      coverage={{
        have: props.periodsWithData.length,
        total: props.availablePeriods.length,
        missing: props.availablePeriods
          .filter((period) => !props.periodsWithData.includes(period))
          .map(formatPeriodLabel),
      }}
    />
  );

  const title =
    props.mode === 'year'
      ? `Calendar ${props.selectedPeriod.slice(0, 4)}`
      : formatPeriodLabel(props.selectedPeriod);

  return (
    <>
      {header}
      <main className="app-main">
        <section className="section">
          <div className="page-head">
            <div>
              <div className="page-kicker">{props.account.displayName}</div>
              <h1 className="page-title">{title}</h1>
            </div>
            <div className="page-sub">
              {props.account.maskedNumber}
              {props.statement
                ? ` · ${formatPeriodRange(props.statement.periodStart, props.statement.periodEnd)}`
                : ''}
            </div>
          </div>

          {props.mode === 'year' ? (
            <YearFlow
              periods={props.availablePeriods}
              summaries={props.summaries}
              withData={props.periodsWithData}
            />
          ) : props.statement ? (
            <SavingsMonth statement={props.statement} transactions={props.transactions} />
          ) : (
            <div className="empty-state">
              <Icon.CalendarX size={26} style={{ color: 'var(--color-accent)', opacity: 0.75 }} />
              <p className="empty-title">Nothing uploaded for {title}</p>
              <p className="empty-body">
                {props.account.openedAt
                  ? `slice statements start from the account opening on ${formatDayLabel(props.account.openedAt)} ${props.account.openedAt.slice(0, 4)}.`
                  : 'Upload the statement PDF for this month and the charts fill in.'}
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
          )}
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

function SavingsMonth({
  statement,
  transactions,
}: {
  statement: SavingsStatement;
  transactions: Transaction[];
}) {
  const mounted = useMounted();
  const theme = mounted ? chartTheme() : null;
  const savings = statement.savings;

  const credits = transactions.filter((txn) => txn.direction === 'credit' && !txn.isInterest);
  const debits = transactions.filter((txn) => txn.direction === 'debit');

  /**
   * One point per day, carrying the last balance printed that day. Days with no
   * transaction hold the balance rather than dropping to zero — the account did
   * not empty, nothing simply happened.
   */
  const daily = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const txn of transactions) {
      if (txn.balanceAfterMinor !== null) byDate.set(txn.date, txn.balanceAfterMinor);
    }
    const out: Array<{ label: string; balance: number }> = [];
    let running = savings.openingBalanceMinor;
    const start = new Date(`${statement.periodStart}T00:00:00Z`);
    const end = new Date(`${statement.periodEnd}T00:00:00Z`);
    for (let day = start; day <= end; day = new Date(day.getTime() + 86_400_000)) {
      const date = day.toISOString().slice(0, 10);
      running = byDate.get(date) ?? running;
      out.push({ label: formatDayLabel(date), balance: running });
      if (out.length > 120) break;
    }
    return out;
  }, [transactions, statement.periodStart, statement.periodEnd, savings.openingBalanceMinor]);

  /**
   * Interest, day by day, as a running total. slice credits it almost every
   * day, so the interesting shape is the accumulation — a bar per day would be
   * thirty-one near-identical marks saying nothing.
   */
  const interestDaily = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const txn of transactions) {
      if (!txn.isInterest) continue;
      byDate.set(txn.date, (byDate.get(txn.date) ?? 0) + txn.amountMinor);
    }
    const out: Array<{ label: string; cumulative: number; onTheDay: number }> = [];
    let running = 0;
    const start = new Date(`${statement.periodStart}T00:00:00Z`);
    const end = new Date(`${statement.periodEnd}T00:00:00Z`);
    for (let day = start; day <= end; day = new Date(day.getTime() + 86_400_000)) {
      const date = day.toISOString().slice(0, 10);
      const onTheDay = byDate.get(date) ?? 0;
      running += onTheDay;
      out.push({ label: formatDayLabel(date), cumulative: running, onTheDay });
      if (out.length > 120) break;
    }
    return out;
  }, [transactions, statement.periodStart, statement.periodEnd]);

  const daysCredited = interestDaily.filter((point) => point.onTheDay > 0).length;
  const balances = daily.map((point) => point.balance);

  return (
    <>
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
          label="Opening balance"
          value={formatMinor(savings.openingBalanceMinor, 0)}
          note="carried forward"
        />
        <StatTile
          label="Money in"
          value={formatMinor(savings.totalCreditsMinor, 0)}
          tone="positive"
          note={`${credits.length} credits`}
        />
        <StatTile
          label="Interest earned"
          value={formatMinor(savings.interestEarnedMinor)}
          tone="positive"
          note="credited daily"
        />
        <StatTile
          label="Money out"
          value={formatMinor(savings.totalDebitsMinor, 0)}
          note={`${debits.length} debits`}
        />
        <StatTile
          label="Closing balance"
          value={formatMinor(savings.closingBalanceMinor, 0)}
          note={formatPeriodRange(statement.periodStart, statement.periodEnd)}
        />
      </TileRow>

      <ChartBlock
        title="Balance, day by day"
        subtitle={formatPeriodRange(statement.periodStart, statement.periodEnd)}
        markColor={theme ? seriesColor(theme, 'primary') : undefined}
        height={210}
        stats={[
          { label: 'Low', value: formatMinor(Math.min(...balances), 0) },
          { label: 'High', value: formatMinor(Math.max(...balances), 0) },
        ]}
      >
        <TrendChart
          data={daily}
          series={[{ key: 'balance', name: 'Closing balance', role: 'primary', area: true }]}
        />
      </ChartBlock>

      {savings.interestEarnedMinor > 0 && (
        <ChartBlock
          title="Interest earned"
          subtitle={`day by day, running total \u00b7 credited on ${daysCredited} of ${interestDaily.length} days`}
          markColor={theme ? seriesColor(theme, 'good') : undefined}
          height={190}
          stats={[
            { label: 'Total', value: formatMinor(savings.interestEarnedMinor) },
            {
              label: 'Average a day',
              value: formatMinor(
                Math.round(savings.interestEarnedMinor / Math.max(daysCredited, 1)),
              ),
            },
          ]}
        >
          <TrendChart
            data={interestDaily}
            series={[
              { key: 'cumulative', name: 'Interest, month to date', role: 'good', area: true },
            ]}
            tooltipExtras={(point) => [
              {
                label: 'Credited that day',
                value:
                  Number(point.onTheDay) > 0 ? formatMinor(Number(point.onTheDay)) : 'nothing',
              },
            ]}
          />
        </ChartBlock>
      )}

      <TransactionsTable
        transactions={transactions}
        variant="savings"
        filters={['all', 'in', 'out', 'interest']}
      />
    </>
  );
}

function YearFlow({
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
      moneyIn: has ? (summary?.incomeMinor ?? 0) : null,
      moneyOut: has ? (summary?.spendMinor ?? 0) : null,
      interest: has ? (summary?.interestMinor ?? 0) : null,
    };
  });

  const total = (key: 'moneyIn' | 'moneyOut' | 'interest') =>
    data.reduce((sum, point) => sum + (point[key] ?? 0), 0);
  const count = withData.length || 1;

  return (
    <>
      <ChartBlock
        title="Money in and out"
        subtitle="per month"
        height={200}
        stats={[
          { label: 'In', value: formatMinor(total('moneyIn'), 0) },
          { label: 'Out', value: formatMinor(total('moneyOut'), 0) },
        ]}
      >
        {/* Two series, so a legend is always present — the identity channel
            never rests on telling two colours apart. */}
        <TrendChart
          data={data}
          series={[
            { key: 'moneyIn', name: 'Money in', role: 'good' },
            { key: 'moneyOut', name: 'Money out', role: 'primary' },
          ]}
        />
      </ChartBlock>

      <ChartBlock
        title="Interest earned"
        subtitle="summed per month"
        markColor={theme ? seriesColor(theme, 'good') : undefined}
        height={180}
        stats={[
          { label: 'Total', value: formatMinor(total('interest')) },
          { label: 'Average', value: formatMinor(Math.round(total('interest') / count)) },
        ]}
      >
        <TrendChart
          data={data}
          series={[{ key: 'interest', name: 'Interest earned', role: 'good', area: true }]}
        />
      </ChartBlock>

      <section className="block">
        <div className="block-head">
          <h3 className="block-title">Month by month</h3>
        </div>
        <div className="table-scroll">
          <table className="table" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Month</th>
                <th className="num">Money in</th>
                <th className="num">Money out</th>
                <th className="num">Interest</th>
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
                    <td className="num">
                      {has ? formatMinor(summary?.incomeMinor ?? 0, 0) : 'no statement'}
                    </td>
                    <td className="num">{has ? formatMinor(summary?.spendMinor ?? 0, 0) : '—'}</td>
                    <td className={`num ${has ? 'is-positive' : 'is-muted'}`}>
                      {has ? formatMinor(summary?.interestMinor ?? 0) : '—'}
                    </td>
                    <td className="num">
                      {has ? formatMinor(summary?.closingBalanceMinor ?? 0, 0) : '—'}
                    </td>
                  </tr>
                );
              })}
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
