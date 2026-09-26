import { Link } from 'react-router';
import { useState } from 'react';
import {
  formatMinor,
  formatPct,
  type Account,
  type Period,
  type Statement,
  type OverviewMonth,
  formatPeriodLabel,
  formatPeriodShort,
} from '@cred-stats/shared';
import { TrendChart } from '../charts/trend-chart';
import { ChartBlock } from '../charts/chart-frame';
import { chartTheme, seriesColor } from '../charts/theme';
import { useMounted } from '../hooks/use-mounted';
import { AppHeader, type PeriodMode } from '../components/app-header';
import { Icon } from '../components/icon';
import { StatTile, TileRow } from '../components/stat-tile';
import { deltaBetween } from '../utils/delta';
import { UploadDialog } from '../components/upload-dialog';

export interface OverviewScreenProps {
  accounts: Account[];
  statements: Statement[];
  /** One row per month that has anything in it, oldest first. */
  months: OverviewMonth[];
  /** The months the switcher offers, oldest first. */
  availablePeriods: Period[];
  selectedPeriod: Period;
  mode: PeriodMode;
  needsReview: Statement[];
}

export function OverviewScreen(props: OverviewScreenProps) {
  const [uploadOpen, setUploadOpen] = useState(false);

  const byPeriod = new Map(props.months.map((month) => [month.period, month]));
  const periodsWithData = props.months.map((month) => month.period);

  const scoped = props.mode === 'year';
  const year = props.selectedPeriod.slice(0, 4);
  const window = scoped
    ? props.availablePeriods.filter((period) => period.startsWith(year))
    : props.availablePeriods;

  // Months the charts actually plot: the ones with something in them. A line
  // dragged across five empty months to reach June says nothing.
  const inScope = props.months.filter((month) =>
    scoped ? month.period.startsWith(year) : window.includes(month.period),
  );

  const current = byPeriod.get(props.selectedPeriod) ?? null;
  const previousPeriod = [...periodsWithData]
    .filter((period) => period < props.selectedPeriod)
    .pop();
  const previous = previousPeriod ? (byPeriod.get(previousPeriod) ?? null) : null;

  const sum = (pick: (month: OverviewMonth) => number): number =>
    inScope.reduce((total, month) => total + pick(month), 0);

  const covered = inScope.length;
  const missing = window
    .filter((period) => !periodsWithData.includes(period))
    .map(formatPeriodLabel);

  const periodLabel = scoped ? `Calendar ${year}` : formatPeriodLabel(props.selectedPeriod);
  const previousLabel = previousPeriod ? formatPeriodLabel(previousPeriod) : '';

  const spend = scoped ? sum((month) => month.spendMinor) : (current?.spendMinor ?? 0);
  const cardSpend = scoped ? sum((month) => month.cardSpendMinor) : (current?.cardSpendMinor ?? 0);
  const cashback = scoped ? sum((month) => month.cashbackMinor) : (current?.cashbackMinor ?? 0);
  const fees = scoped ? sum((month) => month.feesMinor) : (current?.feesMinor ?? 0);
  const payments = scoped ? sum((month) => month.paymentsMinor) : (current?.paymentsMinor ?? 0);

  // Whether a card statement is behind these figures at all. Without one,
  // cashback and fees are absent rather than zero, and showing ₹0.00 claims the
  // card earned nothing in a month it was never asked about.
  const hasCard = scoped
    ? inScope.some((month) => month.hasCardStatement)
    : (current?.hasCardStatement ?? false);

  return (
    <>
      <AppHeader
        title="Overview"
        availablePeriods={props.availablePeriods}
        periodsWithData={periodsWithData}
        selectedPeriod={props.selectedPeriod}
        mode={props.mode}
        coverage={{ have: covered, total: window.length, missing }}
      />

      <main className="app-main">
        <section className="section">
          <div className="page-head">
            <div>
              <div className="page-kicker">Overview</div>
              <h1 className="page-title">{periodLabel}</h1>
            </div>
            <div className="page-sub">
              {props.accounts.length} account{props.accounts.length === 1 ? '' : 's'} · {covered} of{' '}
              {window.length} months uploaded
            </div>
          </div>

          {props.needsReview.length > 0 && (
            <div className="banner" role="status">
              <Icon.Warning size={16} aria-hidden="true" />
              <span className="banner-body">
                {props.needsReview.length} statement
                {props.needsReview.length === 1 ? '' : 's'} did not reconcile.{' '}
                {props.needsReview[0]?.reconciliation.message}{' '}
                <Link to="/library">Open the library</Link> to look at{' '}
                {props.needsReview.length === 1 ? 'it' : 'them'}.
              </span>
            </div>
          )}

          {props.accounts.length === 0 ? (
            <EmptyWorkspace onUpload={() => setUploadOpen(true)} />
          ) : inScope.length === 0 ? (
            <div className="empty-state">
              <Icon.CalendarX size={26} className="is-accent empty-icon" aria-hidden="true" />
              <p className="empty-title">Nothing uploaded for {periodLabel}</p>
              <p className="empty-body">
                Upload a statement for this {scoped ? 'year' : 'month'} and the charts fill in.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
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
                  note={scoped ? `${covered} months` : 'every account'}
                />
                <StatTile
                  label="Cashback"
                  value={hasCard ? formatMinor(cashback) : '\u2014'}
                  tone={hasCard ? 'positive' : 'muted'}
                  size="lg"
                  delta={
                    scoped || !hasCard
                      ? undefined
                      : deltaBetween(cashback, previous?.cashbackMinor ?? null, { previousLabel })
                  }
                  // Against card spend, not total spend: cashback is a card
                  // thing, and dividing it by a savings transfer is meaningless.
                  note={
                    !hasCard
                      ? 'no card statement this period'
                      : cardSpend > 0
                        ? `${formatPct((cashback / cardSpend) * 100, 2)} of card spend`
                        : 'no card spend'
                  }
                />
                <StatTile
                  label="Fees & interest"
                  value={!hasCard ? '\u2014' : fees > 0 ? formatMinor(fees) : 'None'}
                  tone={!hasCard ? 'muted' : fees > 0 ? 'warning' : 'positive'}
                  size="lg"
                  delta={
                    scoped || !hasCard
                      ? undefined
                      : deltaBetween(fees, previous?.feesMinor ?? null, {
                          goodWhenDown: true,
                          previousLabel,
                        })
                  }
                  note={
                    !hasCard
                      ? 'no card statement this period'
                      : fees > 0
                        ? 'charged on the card'
                        : 'nothing charged'
                  }
                />
                <StatTile
                  label="Payments"
                  value={formatMinor(payments, 0)}
                  size="lg"
                  note="received this period"
                />
              </TileRow>

              <OverviewCharts months={inScope} />

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

/**
 * Three charts, each plotting only the months that have the thing it charts.
 *
 * They used to share one x-axis built from every month in the window, so a
 * month with a savings statement and no card statement drew a cashback of
 * zero — a zero that means "no card statement", not "the card earned nothing".
 * Cashback and fees now come from the card accounts alone and skip a month
 * entirely when there is no card statement behind it.
 */
function OverviewCharts({ months }: { months: OverviewMonth[] }) {
  const mounted = useMounted();
  const theme = mounted ? chartTheme() : null;

  const cardMonths = months.filter((month) => month.hasCardStatement);

  const blocks = [
    {
      key: 'value' as const,
      title: 'Spend by month',
      subtitle: `every account · ${months.length} month${months.length === 1 ? '' : 's'}`,
      role: 'primary' as const,
      rows: months.map((month) => ({
        label: formatPeriodShort(month.period),
        value: month.spendMinor,
      })),
    },
    {
      key: 'value' as const,
      title: 'Cashback',
      subtitle:
        cardMonths.length > 0
          ? `credit card only · ${cardMonths.length} cycle${cardMonths.length === 1 ? '' : 's'}`
          : 'no card statements yet',
      role: 'good' as const,
      rows: cardMonths.map((month) => ({
        label: formatPeriodShort(month.period),
        value: month.cashbackMinor,
      })),
    },
    {
      key: 'value' as const,
      title: 'Fees & interest',
      subtitle:
        cardMonths.length > 0
          ? `credit card only · ${cardMonths.length} cycle${cardMonths.length === 1 ? '' : 's'}`
          : 'no card statements yet',
      role: 'cost' as const,
      rows: cardMonths.map((month) => ({
        label: formatPeriodShort(month.period),
        value: month.feesMinor,
      })),
    },
  ];

  return (
    <div className="stack-lg">
      {blocks.map((block) => {
        const total = block.rows.reduce((sum, row) => sum + row.value, 0);
        return (
          <ChartBlock
            key={block.title}
            title={block.title}
            subtitle={block.subtitle}
            markColor={theme ? seriesColor(theme, block.role) : undefined}
            height={180}
            stats={
              block.rows.length > 0
                ? [
                    { label: 'Total', value: formatMinor(total, 0) },
                    {
                      label: 'Average',
                      value: formatMinor(Math.round(total / block.rows.length), 0),
                    },
                  ]
                : undefined
            }
          >
            {block.rows.length > 0 ? (
              <TrendChart
                data={block.rows}
                form="bar"
                series={[{ key: 'value', name: block.title, role: block.role }]}
              />
            ) : (
              <p className="fee-none">
                <Icon.CalendarX size={15} aria-hidden="true" />
                Upload a credit card statement and this fills in.
              </p>
            )}
          </ChartBlock>
        );
      })}
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
          // The selected month if this account has one, otherwise its newest —
          // newest **by period**, not by upload time. A statement uploaded
          // today can be for a month long past, and the list was showing that
          // one as if it were the current state of the account.
          const mine = statements
            .filter((item) => item.accountId === account.accountId)
            .sort((a, b) => b.period.localeCompare(a.period));
          const statement = mine.find((item) => item.period === period) ?? mine[0] ?? null;
          const href =
            account.type === 'savings'
              ? `/savings/${account.accountId}?period=${statement?.period ?? period}`
              : `/accounts/${account.accountId}?period=${statement?.period ?? period}`;

          return (
            <Link key={account.accountId} to={href} className="row-link">
              {account.type === 'savings' ? (
                <Icon.Bank size={17} className="is-accent row-icon" aria-hidden="true" />
              ) : (
                <Icon.CreditCard size={17} className="is-accent row-icon" aria-hidden="true" />
              )}
              <span className="row-main">
                <span className="row-name">{account.displayName}</span>
                <span className="row-sub">
                  {account.maskedNumber}
                  {statement ? ` · ${formatPeriodLabel(statement.period)}` : ' · nothing uploaded'}
                </span>
              </span>
              {statement && <AccountStats statement={statement} />}
              <Icon.ArrowRight size={14} className="row-arrow" aria-hidden="true" />
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
        <Stat
          label="Interest"
          value={formatMinor(statement.savings.interestEarnedMinor)}
          tone="is-positive"
        />
        <Stat label="Net flow" value={`${net >= 0 ? '+' : '−'}${formatMinor(Math.abs(net), 0)}`} />
        <Stat label="Balance" value={formatMinor(statement.savings.closingBalanceMinor, 0)} />
      </>
    );
  }
  return (
    <>
      <Stat
        label="Cashback"
        value={formatMinor(statement.card.cashbackEarnedMinor)}
        tone="is-positive"
      />
      <Stat
        label="Fees"
        value={
          statement.card.otherDebitsMinor > 0 ? formatMinor(statement.card.otherDebitsMinor) : '—'
        }
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
      <Icon.FilePdf size={26} className="is-accent empty-icon" aria-hidden="true" />
      <p className="empty-title">Nothing here yet</p>
      <p className="empty-body">
        Upload a credit card or savings statement PDF. It is unlocked and read in your browser —
        only the figures are kept.
      </p>
      <button type="button" className="btn btn-primary" onClick={onUpload}>
        Upload your first statement
      </button>
    </div>
  );
}
