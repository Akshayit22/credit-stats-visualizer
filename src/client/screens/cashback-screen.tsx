'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { formatMinor, formatPct } from '@/shared/money';
import type { Account, CreditCardStatement, Period, Summary, Transaction } from '@/shared/types';
import { CashbackLine } from '@/client/charts/cashback-line';
import { ChartBlock, useMounted } from '@/client/charts/chart-frame';
import { chartTheme, seriesColor } from '@/client/charts/theme';
import { TrendChart } from '@/client/charts/trend-chart';
import { AppHeader, type PeriodMode } from '@/client/components/app-header';
import { Icon } from '@/client/components/icon';
import { StatTile, TileRow } from '@/client/components/stat-tile';
import { accountShortName, formatDayShort, formatPeriodLabel, formatPeriodRange, formatPeriodShort } from '@/client/lib/format';

export interface CashbackScreenProps {
  account: Account;
  statement: CreditCardStatement | null;
  transactions: Transaction[];
  summaries: Summary[];
  availablePeriods: Period[];
  periodsWithData: Period[];
  selectedPeriod: Period;
  mode: PeriodMode;
}

export function CashbackScreen(props: CashbackScreenProps) {
  const mounted = useMounted();
  const theme = mounted ? chartTheme() : null;
  const isYear = props.mode === 'year';

  const purchases = useMemo(
    () =>
      props.transactions.filter(
        (txn) => txn.direction === 'debit' && !txn.isPayment && !txn.isFee,
      ),
    [props.transactions],
  );
  const earning = purchases.filter((txn) => (txn.cashbackMinor ?? 0) > 0);
  const nothing = purchases.filter((txn) => (txn.cashbackMinor ?? 0) === 0);
  const nothingTotal = nothing.reduce((total, txn) => total + txn.amountMinor, 0);

  const card = props.statement?.card ?? null;
  const spend = card?.purchasesMinor ?? 0;
  const earned = card?.cashbackEarnedMinor ?? 0;
  const credited = card?.cashbackCreditedMinor ?? 0;

  const byCategory = useMemo(() => {
    const totals = new Map<string, { spend: number; cashback: number }>();
    for (const txn of purchases) {
      const entry = totals.get(txn.category) ?? { spend: 0, cashback: 0 };
      entry.spend += txn.amountMinor;
      entry.cashback += txn.cashbackMinor ?? 0;
      totals.set(txn.category, entry);
    }
    return [...totals.entries()]
      .map(([name, entry]) => ({ name, ...entry }))
      .sort((a, b) => b.cashback - a.cashback);
  }, [purchases]);
  const biggestCashback = byCategory[0]?.cashback ?? 1;

  // Only months with a statement. A line stretched across eight empty months
  // to reach one data point says nothing and looks broken.
  const monthly = props.periodsWithData.map((period) => ({
    label: formatPeriodShort(period),
    cashback: props.summaries.find((item) => item.period === period)?.cashbackEarnedMinor ?? 0,
  }));

  const best = [...earning].sort(
    (a, b) => (b.cashbackMinor ?? 0) - (a.cashbackMinor ?? 0),
  )[0];

  const header = (
    <AppHeader
      title={`Cashback \u00b7 ${accountShortName(props.account)}`}
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

  return (
    <>
      {header}
      <main className="app-main">
        <section className="section">
          <div className="page-head">
            <div>
              <div className="page-kicker">Cashback · {props.account.displayName}</div>
              <h1 className="page-title">
                {isYear
                  ? `Calendar ${props.selectedPeriod.slice(0, 4)}`
                  : formatPeriodLabel(props.selectedPeriod)}
              </h1>
            </div>
            <div className="page-sub">
              {isYear
                ? `${props.periodsWithData.length} cycle${props.periodsWithData.length === 1 ? '' : 's'} uploaded`
                : props.statement
                  ? formatPeriodRange(props.statement.periodStart, props.statement.periodEnd)
                  : props.account.maskedNumber}
            </div>
          </div>

          {isYear ? (
            <CashbackYear
              periodsWithData={props.periodsWithData}
              summaries={props.summaries}
              monthly={monthly}
              theme={theme}
            />
          ) : !props.statement ? (
            <div className="empty-state">
              <Icon.Percent size={24} style={{ opacity: 0.5 }} />
              <p className="empty-title">
                Nothing uploaded for {formatPeriodLabel(props.selectedPeriod)}
              </p>
              <p className="empty-body">
                Upload this cycle&rsquo;s statement and the cashback breakdown fills in.
              </p>
            </div>
          ) : (
            <>
              <TileRow>
                <StatTile
                  label="Earned this cycle"
                  value={formatMinor(earned)}
                  tone="positive"
                  note={`on ${formatMinor(spend, 0)} of spend`}
                />
                <StatTile
                  label="Credited this cycle"
                  value={formatMinor(credited)}
                  note="earned in the previous cycle"
                />
                <StatTile
                  label="Effective rate"
                  value={spend > 0 ? formatPct((earned / spend) * 100, 2) : '—'}
                  note="across every purchase"
                />
                <StatTile
                  label="Earning transactions"
                  value={`${earning.length} of ${purchases.length}`}
                  note={`${formatMinor(nothingTotal, 0)} earned nothing`}
                />
              </TileRow>

              {earned !== credited && (
                <p className="page-sub">
                  Earned and credited differ because the issuer credits a cycle&rsquo;s cashback in
                  the next one, subject to its cap. Both figures are kept as the statement printed
                  them.
                </p>
              )}

              <ChartBlock
                title="Cashback, transaction by transaction"
                subtitle="in the order they happened · a dip to zero earned nothing"
                markColor={theme ? seriesColor(theme, 'good') : undefined}
                height={230}
                stats={
                  best
                    ? [
                        {
                          label: 'Best',
                          value: `${best.merchant} · ${formatMinor(best.cashbackMinor ?? 0)}`,
                        },
                      ]
                    : undefined
                }
              >
                <CashbackLine
                  points={purchases.map((txn) => ({
                    merchant: txn.merchant || txn.descriptionRaw,
                    date: formatDayShort(txn.date),
                    spendMinor: txn.amountMinor,
                    cashbackMinor: txn.cashbackMinor ?? 0,
                  }))}
                />
              </ChartBlock>

              <div className="split">
                <ChartBlock
                  title="By month"
                  subtitle={`${props.periodsWithData.length} cycles uploaded`}
                  markColor={theme ? seriesColor(theme, 'good') : undefined}
                  height={190}
                >
                  <TrendChart
                    data={monthly}
                    form="bar"
                    series={[{ key: 'cashback', name: 'Cashback', role: 'good' }]}
                  />
                </ChartBlock>

                <section className="block">
                  <div className="block-head">
                    <h3 className="block-title">By category</h3>
                    <span className="block-sub">rate achieved</span>
                  </div>
                  <div>
                    {byCategory.map((entry) => (
                      <div key={entry.name} className="cashback-cat">
                        <div className="bar-row-line">
                          <span className="bar-row-name">{entry.name}</span>
                          <span className="bar-row-share is-muted">
                            {formatPct(entry.spend > 0 ? (entry.cashback / entry.spend) * 100 : 0, 2)}
                          </span>
                          <span
                            className={`bar-row-amount ${entry.cashback > 0 ? '' : 'is-muted'}`}
                          >
                            {entry.cashback > 0 ? formatMinor(entry.cashback) : 'nil'}
                          </span>
                        </div>
                        <span className="bar-track">
                          <span
                            className="bar-fill"
                            data-tone="positive"
                            style={{ width: `${(entry.cashback / biggestCashback) * 100}%` }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="block">
                <div className="block-head">
                  <h3 className="block-title">Earned nothing</h3>
                  <span className="block-sub">
                    {nothing.length} purchase{nothing.length === 1 ? '' : 's'} ·{' '}
                    {formatMinor(nothingTotal, 0)}
                  </span>
                </div>
                {nothing.length === 0 ? (
                  <p className="fee-none">
                    <Icon.Check size={15} className="is-positive" aria-hidden="true" />
                    Every purchase this cycle earned something.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 80 }}>Date</th>
                          <th>Details</th>
                          <th style={{ width: 150 }}>Category</th>
                          <th className="num" style={{ width: 120 }}>
                            Spend
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {nothing.map((txn) => (
                          <tr key={txn.txnId}>
                            <td className="cell-dim">{formatDayShort(txn.date)}</td>
                            <td style={{ fontSize: 13 }}>{txn.merchant || txn.descriptionRaw}</td>
                            <td className="is-muted" style={{ fontSize: 11.5 }}>
                              {txn.category}
                            </td>
                            <td className="num">{formatMinor(txn.amountMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="page-sub">
                <Link href={`/accounts/${props.account.accountId}?period=${props.selectedPeriod}`}>
                  ← Back to the statement
                </Link>
              </p>
            </>
          )}
        </section>
      </main>
    </>
  );
}

/**
 * Cashback across a whole year. The month view is per cycle; this is the same
 * question asked of every cycle at once, which is what "Year" was silently
 * failing to answer — it used to land on December, find no statement there, and
 * say "nothing uploaded" while eight months of data sat beside it.
 */
function CashbackYear({
  periodsWithData,
  summaries,
  monthly,
  theme,
}: {
  periodsWithData: Period[];
  summaries: Summary[];
  monthly: Array<{ label: string; cashback: number }>;
  theme: ReturnType<typeof chartTheme> | null;
}) {
  const inYear = summaries.filter((summary) => periodsWithData.includes(summary.period));

  if (inYear.length === 0) {
    return (
      <div className="empty-state">
        <Icon.Percent size={24} style={{ opacity: 0.5 }} />
        <p className="empty-title">No statements for this year yet</p>
        <p className="empty-body">
          Upload a cycle&rsquo;s statement and the year fills in.
        </p>
      </div>
    );
  }

  const earned = inYear.reduce((total, summary) => total + summary.cashbackEarnedMinor, 0);
  const credited = inYear.reduce((total, summary) => total + summary.cashbackCreditedMinor, 0);
  const spend = inYear.reduce((total, summary) => total + summary.spendMinor, 0);
  const best = [...inYear].sort((a, b) => b.cashbackEarnedMinor - a.cashbackEarnedMinor)[0];

  return (
    <>
      <TileRow>
        <StatTile
          label="Earned this year"
          value={formatMinor(earned)}
          tone="positive"
          note={`across ${inYear.length} cycle${inYear.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Credited this year"
          value={formatMinor(credited)}
          note="each cycle is credited in the next"
        />
        <StatTile
          label="Effective rate"
          value={spend > 0 ? formatPct((earned / spend) * 100, 2) : '\u2014'}
          note={`on ${formatMinor(spend, 0)} of spend`}
        />
        <StatTile
          label="Best cycle"
          value={best ? formatMinor(best.cashbackEarnedMinor) : '\u2014'}
          note={best ? formatPeriodLabel(best.period) : undefined}
        />
      </TileRow>

      <ChartBlock
        title="Cashback by cycle"
        subtitle="only months with a statement"
        markColor={theme ? seriesColor(theme, 'good') : undefined}
        height={200}
        stats={[
          { label: 'Total', value: formatMinor(earned) },
          {
            label: 'Average',
            value: formatMinor(Math.round(earned / Math.max(inYear.length, 1))),
          },
        ]}
      >
        <TrendChart
          data={monthly}
          form="bar"
          series={[{ key: 'cashback', name: 'Cashback', role: 'good' }]}
        />
      </ChartBlock>

      <section className="block">
        <div className="block-head">
          <h3 className="block-title">Cycle by cycle</h3>
        </div>
        <div className="table-scroll">
          <table className="table" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Cycle</th>
                <th className="num">Spend</th>
                <th className="num">Earned</th>
                <th className="num">Credited</th>
                <th className="num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {inYear.map((summary) => (
                <tr key={summary.period}>
                  <td style={{ fontSize: 12.5 }}>{formatPeriodLabel(summary.period)}</td>
                  <td className="num">{formatMinor(summary.spendMinor, 0)}</td>
                  <td className="num is-positive">{formatMinor(summary.cashbackEarnedMinor)}</td>
                  <td className="num">{formatMinor(summary.cashbackCreditedMinor)}</td>
                  <td className="num is-muted">
                    {summary.spendMinor > 0
                      ? formatPct((summary.cashbackEarnedMinor / summary.spendMinor) * 100, 2)
                      : '\u2014'}
                  </td>
                </tr>
              ))}
              <tr className="total-row">
                <td style={{ fontSize: 12.5 }}>Total</td>
                <td className="num">{formatMinor(spend, 0)}</td>
                <td className="num is-positive">{formatMinor(earned)}</td>
                <td className="num">{formatMinor(credited)}</td>
                <td className="num is-muted">
                  {spend > 0 ? formatPct((earned / spend) * 100, 2) : '\u2014'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
