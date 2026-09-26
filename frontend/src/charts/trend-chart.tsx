import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMinor, formatMinorCompact } from '@cred-stats/shared';
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

export type TrendForm = 'line' | 'bar';

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
  tooltipExtras,
  form = 'line',
  baseline = 'zero',
}: {
  data: TrendPoint[];
  series: TrendSeries[];
  emptyMessage?: string;
  yTickCount?: number;
  /**
   * `line` for a continuous quantity read over time — a balance, a running
   * total, a day-by-day figure. `bar` for comparing discrete buckets, which is
   * what a month-by-month view is: a line between two months implies values in
   * between that do not exist, and with one month it draws nothing at all.
   */
  form?: TrendForm;
  /**
   * `zero` anchors the axis at zero, which is the honest default and required
   * for bars. `auto` fits the axis to the data — only for a line where the
   * variation is the whole point and would otherwise be a flat line (daily
   * interest moving between 30.43 and 39.69, say).
   */
  baseline?: 'zero' | 'auto';
  /**
   * Extra rows for the hovered point, from fields that are carried on the data
   * but not plotted. A running total is only readable as one line; what was
   * credited on the day belongs in the tooltip, not as a second series nobody
   * asked for.
   */
  tooltipExtras?: (point: TrendPoint) => Array<{ label: string; value: string }>;
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
          domain={baseline === 'auto' ? ['dataMin', 'dataMax'] : [0, 'auto']}
          allowDecimals={false}
          tickFormatter={(value: number) => formatMinorCompact(value)}
        />
        <Tooltip
          cursor={
            form === 'bar'
              ? { fill: 'color-mix(in srgb, currentColor 6%, transparent)' }
              : { stroke: theme.crosshair, strokeWidth: 1 }
          }
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const rows = payload.filter(
              (entry) => entry.value !== null && entry.value !== undefined,
            );
            if (rows.length === 0) {
              return <TooltipEmpty title={String(label)} message={emptyMessage} />;
            }
            const point = rows[0]?.payload as TrendPoint | undefined;
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
                {point &&
                  tooltipExtras?.(point).map((extra) => (
                    <TooltipRow key={extra.label} label={extra.label} value={extra.value} />
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
          // `key` is deliberately NOT in here. React reads it before props are
          // applied, so spreading an object that contains one is a no-op that
          // React warns about — it has to be written on the element itself.
          const common = {
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

          if (form === 'bar') {
            return (
              <Bar
                key={entry.key}
                dataKey={entry.key}
                name={entry.name}
                fill={color}
                // Capped rather than filling the slot: the leftover is air.
                maxBarSize={24}
                // 4px rounded data-end, square at the baseline.
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            );
          }
          return entry.area ? (
            <Area key={entry.key} {...common} type="linear" fill={color} fillOpacity={0.1} />
          ) : (
            <Line key={entry.key} {...common} type="linear" />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
