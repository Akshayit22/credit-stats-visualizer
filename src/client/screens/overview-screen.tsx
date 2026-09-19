'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatMinor, formatPct } from '@/shared/money';
import type { Account, Period, Statement, Summary } from '@/shared/types';
import { TrendChart } from '@/client/charts/trend-chart';
import { ChartBlock } from '@/client/charts/chart-frame';
import { chartTheme, seriesColor } from '@/client/charts/theme';
import { useMounted } from '@/client/charts/chart-frame';
import { AppHeader, type PeriodMode } from '@/client/components/app-header';
import { Icon } from '@/client/components/icon';
import { StatTile, TileRow, deltaBetween } from '@/client/components/stat-tile';
import { UploadDialog } from '@/client/components/upload-dialog';
import { formatPeriodLabel, formatPeriodShort } from '@/client/lib/format';

export interface OverviewScreenProps {
  accounts: Account[];
  statements: Statement[];
  /** `ALL#<period>` summaries for the whole window, oldest first. */
  summaries: Summary[];
  /** The months the switcher offers, oldest first. */
  availablePeriods: Period[];
  selectedPeriod: Period;
  mode: PeriodMode;
  needsReview: Statement[];
}

export function OverviewScreen(props: OverviewScreenProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const byPeriod = new Map(props.summaries.map((summary) => [summary.period, summary]));
  const periodsWithData = props.summaries
    .filter((summary) => summary.txnCount > 0)
    .map((summary) => summary.period);

  const scoped = props.mode === 'year';
  const window = scoped
    ? props.availablePeriods.filter((period) => period.startsWith(props.selectedPeriod.slice(0, 4)))
    : props.availablePeriods;

  const current = byPeriod.get(props.selectedPeriod) ?? null;
  const previousPeriod = [...periodsWithData]
    .filter((period) => period < props.selectedPeriod)
    .pop();
  const previous = previousPeriod ? (byPeriod.get(previousPeriod) ?? null) : null;

  const totalOf = (pick: (summary: Summary) => number): number =>
    window.reduce((total, period) => total + (byPeriod.get(period) ? pick(byPeriod.get(period) as Summary) : 0), 0);

  const covered = window.filter((period) => periodsWithData.includes(period));
  const missing = window.filter((period) => !periodsWithData.includes(period)).map(formatPeriodLabel);

  const periodLabel = scoped
    ? `Calendar ${props.selectedPeriod.slice(0, 4)}`
    : formatPeriodLabel(props.selectedPeriod);
  const previousLabel = previousPeriod ? formatPeriodLabel(previousPeriod) : '';

  const spend = scoped ? totalOf((s) => s.spendMinor) : (current?.spendMinor ?? 0);
  const cashback = scoped ? totalOf((s) => s.cashbackEarnedMinor) : (current?.cashbackEarnedMinor ?? 0);
  const fees = scoped ? totalOf((s) => s.feesMinor) : (current?.feesMinor ?? 0);
  const payments = scoped ? totalOf((s) => s.paymentsMinor) : (current?.paymentsMinor ?? 0);

  return (
    <>
      <AppHeader
        title="Overview"
        availablePeriods={props.availablePeriods}
        periodsWithData={periodsWithData}
        selectedPeriod={props.selectedPeriod}
        mode={props.mode}
        coverage={{ have: covered.length, total: window.length, missing }}
      />

      <main className="app-main">
        <section className="section">
          <div className="page-head">
            <div>
              <div className="page-kicker">Overview</div>
              <h1 className="page-title">{periodLabel}</h1>
            </div>
            <div className="page-sub">
              {props.accounts.length} account{props.accounts.length === 1 ? '' : 's'} ·{' '}
              {covered.length} of {window.length} months uploaded
            </div>
          </div>

          {props.needsReview.length > 0 && (
            <div className="banner" role="status">
              <Icon.Warning size={16} aria-hidden="true" />
              <span className="banner-body">
                {props.needsReview.length} statement
                {props.needsReview.length === 1 ? '' : 's'} did not reconcile.{' '}
                {props.needsReview[0]?.reconciliation.message}{' '}
                <Link href="/library">Open the library</Link> to look at{' '}
                {props.needsReview.length === 1 ? 'it' : 'them'}.
              </span>
            </div>
          )}

          {props.accounts.length === 0 ? (
            <EmptyWorkspace onUpload={() => setUploadOpen(true)} />
          ) : !current && !scoped ? (
            <div className="empty-state">
              <Icon.CalendarX size={26} style={{ color: 'var(--color-accent)', opacity: 0.75 }} />
              <p className="empty-title">Nothing uploaded for {periodLabel}</p>
              <p className="empty-body">
                Upload the statement PDF for this month and the charts fill in.
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
            <>
              <TileRow>
                <StatTile
                  label="Spend"
                  value={formatMinor(spend, 0)}
                  size="lg"
                  delta={
                    scoped
                      ? undefined
                      : deltaBetween(spend, previous?.spendMinor ?? null, {
                          goodWhenDown: true,
                          previousLabel,
                        })
                  }
                  note={scoped ? `${covered.length} months` : undefined}
                />
                <StatTile
                  label="Cashback"
                  value={formatMinor(cashback)}
                  tone="positive"
                  size="lg"
                  delta={
                    scoped
                      ? undefined
                      : deltaBetween(cashback, previous?.cashbackEarnedMinor ?? null, {
                          previousLabel,
                        })
                  }
                  note={spend > 0 ? `${formatPct((cashback / spend) * 100, 2)} of spend` : undefined}
                />
                <StatTile
                  label="Fees & interest"
                  value={fees > 0 ? formatMinor(fees) : 'None'}
                  tone={fees > 0 ? 'warning' : 'positive'}
                  size="lg"
                  delta={
                    scoped
                      ? undefined
                      : deltaBetween(fees, previous?.feesMinor ?? null, {
                          goodWhenDown: true,
                          previousLabel,
                        })
                  }
                  note={fees > 0 ? undefined : 'nothing charged'}
                />
                <StatTile
                  label="Payments"
                  value={formatMinor(payments, 0)}
                  size="lg"
                  note="received this period"
                />
              </TileRow>

              <OverviewCharts periods={window} byPeriod={byPeriod} />

              <AccountsList
                accounts={props.accounts}
                statements={props.statements}
                period={props.selectedPeriod}
              />
            </>
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

function OverviewCharts({
  periods,
  byPeriod,
}: {
  periods: Period[];
  byPeriod: Map<Period, Summary>;
}) {
  const mounted = useMounted();
  const theme = mounted ? chartTheme() : null;

  const data = periods.map((period) => {
    const summary = byPeriod.get(period);
    return {
      label: formatPeriodShort(period),
      spend: summary && summary.txnCount > 0 ? summary.spendMinor : null,
      cashback: summary && summary.txnCount > 0 ? summary.cashbackEarnedMinor : null,
      fees: summary && summary.txnCount > 0 ? summary.feesMinor : null,
    };
  });

  const withData = data.filter((point) => point.spend !== null).length || 1;
  const total = (key: 'spend' | 'cashback' | 'fees') =>
    data.reduce((sum, point) => sum + (point[key] ?? 0), 0);

  const blocks = [
    {
      key: 'spend' as const,
      title: 'Bill by month',
      subtitle: 'purchases and charges per statement',
      role: 'primary' as const,
    },
    {
      key: 'cashback' as const,
      title: 'Cashback',
      subtitle: 'earned per cycle',
      role: 'good' as const,
    },
    {
      key: 'fees' as const,
      title: 'Fees & interest',
      subtitle: 'charged per cycle',
      role: 'cost' as const,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--space-8) * 1.35)' }}>
      {blocks.map((block) => (
        <ChartBlock
          key={block.key}
          title={block.title}
          subtitle={block.subtitle}
          markColor={theme ? seriesColor(theme, block.role) : undefined}
          height={180}
          stats={[
            { label: 'Total', value: formatMinor(total(block.key), 0) },
            { label: 'Average', value: formatMinor(Math.round(total(block.key) / withData), 0) },
          ]}
        >
          <TrendChart
            data={data}
            series={[
              { key: block.key, name: block.title, role: block.role, area: true },
            ]}
          />
        </ChartBlock>
      ))}
    </div>
  );
}

function AccountsList({
  accounts,
  statements,
  period,
}: {
  accounts: Account[];
  statements: Statement[];
  period: Period;
}) {
  return (
    <section className="block">
      <div className="block-head">
        <h3 className="block-title">Accounts</h3>
      </div>
      <div className="row-list">
        {accounts.map((account) => {
          const statement =
            statements.find((item) => item.accountId === account.accountId && item.period === period) ??
            statements.find((item) => item.accountId === account.accountId) ??
            null;
          const href =
            account.type === 'savings'
              ? `/savings/${account.accountId}?period=${statement?.period ?? period}`
              : `/accounts/${account.accountId}?period=${statement?.period ?? period}`;

          return (
            <Link key={account.accountId} href={href} className="row-link">
              {account.type === 'savings' ? (
                <Icon.Bank size={17} style={{ color: 'var(--color-accent)', opacity: 0.8 }} />
              ) : (
                <Icon.CreditCard size={17} style={{ color: 'var(--color-accent)', opacity: 0.8 }} />
              )}
              <span className="row-main">
                <span className="row-name">{account.displayName}</span>
                <span className="row-sub">
                  {account.maskedNumber}
                  {statement ? ` · ${formatPeriodLabel(statement.period)}` : ' · nothing uploaded'}
                </span>
              </span>
              {statement && <AccountStats statement={statement} />}
              <Icon.ArrowRight size={14} style={{ opacity: 0.4, flex: 'none' }} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function AccountStats({ statement }: { statement: Statement }) {
  if (statement.accountType === 'savings') {
    const net = statement.savings.totalCreditsMinor - statement.savings.totalDebitsMinor;
    return (
      <>
        <Stat label="Interest" value={formatMinor(statement.savings.interestEarnedMinor)} tone="is-positive" />
        <Stat
          label="Net flow"
          value={`${net >= 0 ? '+' : '−'}${formatMinor(Math.abs(net), 0)}`}
        />
        <Stat label="Balance" value={formatMinor(statement.savings.closingBalanceMinor, 0)} />
      </>
    );
  }
  return (
    <>
      <Stat label="Cashback" value={formatMinor(statement.card.cashbackEarnedMinor)} tone="is-positive" />
      <Stat
        label="Fees"
        value={statement.card.otherDebitsMinor > 0 ? formatMinor(statement.card.otherDebitsMinor) : '—'}
        tone={statement.card.otherDebitsMinor > 0 ? 'is-warning' : 'is-muted'}
      />
      <Stat label="Bill" value={formatMinor(statement.card.totalDueMinor, 0)} />
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="row-stat">
      <span className="row-stat-label">{label}</span>
      <span className={`row-stat-value ${tone ?? ''}`}>{value}</span>
    </span>
  );
}

function EmptyWorkspace({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="empty-state">
      <Icon.FilePdf size={26} style={{ color: 'var(--color-accent)', opacity: 0.75 }} />
      <p className="empty-title">Nothing here yet</p>
      <p className="empty-body">
        Upload a credit card or savings statement PDF. It is unlocked and read in your browser —
        only the figures are kept.
      </p>
      <button type="button" className="btn btn-primary" style={{ marginTop: 4 }} onClick={onUpload}>
        Upload your first statement
      </button>
    </div>
  );
}
