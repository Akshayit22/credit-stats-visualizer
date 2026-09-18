'use client';

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { formatMinor, formatMinorCompact, formatPct } from '@/shared/money';
import { chartTheme, seriesColor } from './theme';
import { TooltipRow, TooltipShell } from './tooltip';

export interface CashbackPoint {
  merchant: string;
  date: string;
  spendMinor: number;
  cashbackMinor: number;
}

/**
 * Cashback against spend, one dot per purchase. A scatter rather than the
 * mockup's line: these points have no order along x, and joining them would
 * draw a trend that does not exist.
 *
 * Rows that earned nothing sit on the zero line, which is the point — they are
 * the ones worth noticing, and the "Earned nothing" list names them.
 */
export function CashbackScatter({ points }: { points: CashbackPoint[] }) {
  const theme = chartTheme();
  const earning = points.filter((point) => point.cashbackMinor > 0);
  const nothing = points.filter((point) => point.cashbackMinor === 0);
  const good = seriesColor(theme, 'good');
  const muted = theme.axisText;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
        <CartesianGrid stroke={theme.grid} strokeWidth={1} />
        <XAxis
          type="number"
          dataKey="spendMinor"
          name="Spend"
          tick={{ fill: theme.axisText, fontSize: 11, fontFamily: theme.font }}
          tickLine={false}
          axisLine={{ stroke: theme.axis }}
          tickFormatter={(value: number) => formatMinorCompact(value)}
          label={{
            value: 'spend',
            position: 'insideBottomRight',
            offset: -10,
            fill: theme.axisText,
            fontSize: 10,
          }}
        />
        <YAxis
          type="number"
          dataKey="cashbackMinor"
          name="Cashback"
          tick={{ fill: theme.axisText, fontSize: 11, fontFamily: theme.font }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) => formatMinorCompact(value)}
        />
        <ZAxis range={[60, 60]} />
        <Tooltip
          cursor={{ stroke: theme.crosshair, strokeWidth: 1 }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as CashbackPoint | undefined;
            if (!active || !point) return null;
            const rate = point.spendMinor > 0 ? (point.cashbackMinor / point.spendMinor) * 100 : 0;
            return (
              <TooltipShell title={point.merchant}>
                <TooltipRow label="Spend" value={formatMinor(point.spendMinor)} />
                <TooltipRow
                  label="Cashback"
                  value={point.cashbackMinor > 0 ? formatMinor(point.cashbackMinor) : 'nothing'}
                  color={point.cashbackMinor > 0 ? good : undefined}
                  tone={point.cashbackMinor > 0 ? 'positive' : 'muted'}
                />
                <TooltipRow label="Rate" value={formatPct(rate, 2)} />
                <TooltipRow label="Date" value={point.date} />
              </TooltipShell>
            );
          }}
        />
        <Scatter
          name="Earned cashback"
          data={earning}
          fill={good}
          stroke={theme.ground}
          strokeWidth={2}
          isAnimationActive={false}
        />
        {/* Hollow, muted marks: same shape, no colour claim. The list below
            names every one of them. */}
        <Scatter
          name="Earned nothing"
          data={nothing}
          fill="transparent"
          stroke={muted}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
