'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMinor, formatMinorCompact } from '@/shared/money';
import { chartTheme, seriesColor, type SeriesRole } from './theme';
import { TooltipEmpty, TooltipRow, TooltipShell } from './tooltip';

export interface TrendPoint {
  /** The x-axis label, already formatted. */
  label: string;
  /** Paise, or null for "no statement for that month". */
  [series: string]: string | number | null;
}

export interface TrendSeries {
  key: string;
  name: string;
  role: SeriesRole;
  /** A wash under the line. Only for a single-series chart. */
  area?: boolean;
}

/**
 * The line chart every trend uses: 2px lines, markers on every point, a
 * recessive hairline grid, a crosshair on hover, and gaps where a month has no
 * statement rather than a line drawn straight through the missing month.
 */
export function TrendChart({
  data,
  series,
  emptyMessage = 'no statement',
  yTickCount = 4,
}: {
  data: TrendPoint[];
  series: TrendSeries[];
  emptyMessage?: string;
  yTickCount?: number;
}) {
  const theme = chartTheme();
  const multi = series.length > 1;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: multi ? 4 : 0 }}>
        <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: theme.axisText, fontSize: 11, fontFamily: theme.font }}
          tickLine={false}
          axisLine={{ stroke: theme.axis }}
          interval="preserveStartEnd"
          minTickGap={12}
        />
        <YAxis
          tick={{ fill: theme.axisText, fontSize: 11, fontFamily: theme.font }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickCount={yTickCount}
          tickFormatter={(value: number) => formatMinorCompact(value)}
        />
        <Tooltip
          cursor={{ stroke: theme.crosshair, strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const rows = payload.filter((entry) => entry.value !== null && entry.value !== undefined);
            if (rows.length === 0) {
              return <TooltipEmpty title={String(label)} message={emptyMessage} />;
            }
            return (
              <TooltipShell title={String(label)}>
                {rows.map((entry) => (
                  <TooltipRow
                    key={String(entry.dataKey)}
                    label={String(entry.name)}
                    value={formatMinor(Number(entry.value))}
                    color={String(entry.color)}
                  />
                ))}
              </TooltipShell>
            );
          }}
        />
        {/* A legend is the dependable identity channel whenever there is more
            than one series. One series needs none — the title names it. */}
        {multi && (
          <Legend
            verticalAlign="bottom"
            height={26}
            iconType="plainline"
            iconSize={14}
            wrapperStyle={{ fontSize: 11, color: theme.axisText, fontFamily: theme.font }}
          />
        )}
        {series.map((entry) => {
          const color = seriesColor(theme, entry.role);
          const common = {
            key: entry.key,
            dataKey: entry.key,
            name: entry.name,
            stroke: color,
            strokeWidth: 2,
            connectNulls: false,
            isAnimationActive: false,
            dot: {
              r: 4,
              fill: color,
              // A 2px ring in the ground colour keeps markers legible where
              // they cross the line or each other.
              stroke: theme.ground,
              strokeWidth: 2,
            },
            activeDot: { r: 5, fill: color, stroke: theme.ground, strokeWidth: 2 },
          } as const;

          return entry.area ? (
            <Area {...common} type="linear" fill={color} fillOpacity={0.1} />
          ) : (
            <Line {...common} type="linear" />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
