import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMinor, formatMinorCompact, formatPct } from '@cred-stats/shared';
import { chartTheme, seriesColor } from './theme';
import { TooltipRow, TooltipShell } from './tooltip';

export interface CashbackPoint {
  merchant: string;
  date: string;
  spendMinor: number;
  cashbackMinor: number;
}

/**
 * Cashback, purchase by purchase, **in the order they happened**.
 *
 * This used to be a scatter of cashback against spend. That plot is technically
 * defensible — the two are correlated, which is what it showed — but it was
 * nearly all whitespace with one point in the far corner, and it answered a
 * question nobody asks. "Did this purchase earn anything?" is the question, and
 * it is a sequence through the cycle, so the points connect.
 *
 * A purchase that earned nothing sits on zero, which is exactly the dip you
 * want to notice; the "Earned nothing" list below names each one.
 */
export function CashbackLine({ points }: { points: CashbackPoint[] }) {
  const theme = chartTheme();
  const good = seriesColor(theme, 'good');

  const data = points.map((point, index) => ({
    ...point,
    index,
    // A short label; the tooltip carries the full merchant name.
    label: point.date,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: theme.axisText, fontSize: 11, fontFamily: theme.font }}
          tickLine={false}
          axisLine={{ stroke: theme.axis }}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: theme.axisText, fontSize: 11, fontFamily: theme.font }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickCount={4}
          domain={[0, 'auto']}
          tickFormatter={(value: number) => formatMinorCompact(value)}
        />
        <Tooltip
          cursor={{ stroke: theme.crosshair, strokeWidth: 1 }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (CashbackPoint & { label: string }) | undefined;
            if (!active || !point) return null;
            const rate = point.spendMinor > 0 ? (point.cashbackMinor / point.spendMinor) * 100 : 0;
            return (
              <TooltipShell title={point.merchant}>
                <TooltipRow label="Date" value={point.date} />
                <TooltipRow label="Spend" value={formatMinor(point.spendMinor)} />
                <TooltipRow
                  label="Cashback"
                  value={point.cashbackMinor > 0 ? formatMinor(point.cashbackMinor) : 'nothing'}
                  color={point.cashbackMinor > 0 ? good : undefined}
                  tone={point.cashbackMinor > 0 ? 'positive' : 'muted'}
                />
                <TooltipRow label="Rate" value={formatPct(rate, 2)} />
              </TooltipShell>
            );
          }}
        />
        <Line
          type="linear"
          dataKey="cashbackMinor"
          name="Cashback"
          stroke={good}
          strokeWidth={2}
          isAnimationActive={false}
          dot={{ r: 4, fill: good, stroke: theme.ground, strokeWidth: 2 }}
          activeDot={{ r: 5, fill: good, stroke: theme.ground, strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
