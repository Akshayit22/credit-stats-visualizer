'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { formatMinor, formatPct } from '@/shared/money';
import type { Account, CreditCardStatement, Period, Summary, Transaction } from '@/shared/types';
import { CashbackScatter } from '@/client/charts/cashback-scatter';
import { ChartBlock, useMounted } from '@/client/charts/chart-frame';
import { chartTheme, seriesColor } from '@/client/charts/theme';
import { TrendChart } from '@/client/charts/trend-chart';
import { AppHeader, type PeriodMode } from '@/client/components/app-header';
import { Icon } from '@/client/components/icon';
import { StatTile, TileRow } from '@/client/components/stat-tile';
import { formatDayShort, formatPeriodLabel, formatPeriodRange, formatPeriodShort } from '@/client/lib/format';

export interface CashbackScreenProps {
  account: Account;
  accounts: Account[];
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

  const monthly = props.availablePeriods.map((period) => {
    const summary = props.summaries.find((item) => item.period === period);
    const has = props.periodsWithData.includes(period);
    return {
      label: formatPeriodShort(period),
      cashback: has ? (summary?.cashbackEarnedMinor ?? 0) : null,
    };
  });

  const best = [...earning].sort(
    (a, b) => (b.cashbackMinor ?? 0) - (a.cashbackMinor ?? 0),
  )[0];

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
              <h1 className="page-title">{formatPeriodLabel(props.selectedPeriod)}</h1>
            </div>
            <div className="page-sub">
              {props.statement
                ? formatPeriodRange(props.statement.periodStart, props.statement.periodEnd)
                : props.account.maskedNumber}
            </div>
          </div>

          {!props.statement ? (
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
                subtitle="each dot is one purchase · hover for the merchant and the rate"
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
                <CashbackScatter
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
                    series={[{ key: 'cashback', name: 'Cashback', role: 'good', area: true }]}
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
