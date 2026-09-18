'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMinor, formatPct } from '@/shared/money';
import { chartTheme } from './theme';
import { TooltipRow, TooltipShell } from './tooltip';

export interface CategorySlice {
  name: string;
  amountMinor: number;
}

/** Past six slices a ring is unreadable; the rest fold into one "Other". */
const MAX_SLICES = 6;

export function foldToTopSlices(slices: CategorySlice[]): CategorySlice[] {
  const ranked = [...slices].sort((a, b) => b.amountMinor - a.amountMinor);
  if (ranked.length <= MAX_SLICES) return ranked;
  const head = ranked.slice(0, MAX_SLICES - 1);
  const rest = ranked.slice(MAX_SLICES - 1);
  return [
    ...head,
    {
      name: `Other (${rest.length})`,
      amountMinor: rest.reduce((total, slice) => total + slice.amountMinor, 0),
    },
  ];
}

/**
 * A ranked part-to-whole. The ring is drawn from a **sequential** ramp in
 * magnitude order — one hue, light to dark — not a categorical palette: eight
 * distinguishable hues do not exist on this ground, and pretending otherwise
 * would give two categories colours nobody can tell apart.
 *
 * Identity therefore never rests on colour: the list underneath names every
 * slice with its share and amount, and is also the filter — one list doing
 * identity and interaction at once, rather than the same categories printed
 * twice on the same screen.
 */
export function CategoryDonut({
  slices,
  total,
  selected,
  onSelect,
}: {
  slices: CategorySlice[];
  total: number;
  /** The category the table is filtered to, if any. */
  selected?: string | null;
  /** Click a row to filter; the same rows are the ring's legend. */
  onSelect?: (category: string | null) => void;
}) {
  const theme = chartTheme();
  const data = foldToTopSlices(slices);
  const colorFor = (index: number) =>
    theme.sequential[Math.min(index, theme.sequential.length - 1)] ?? theme.sequential[0];

  return (
    <div className="donut">
      <div className="donut-ring">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => {
                const entry = payload?.[0];
                if (!active || !entry) return null;
                const amountMinor = Number(entry.value);
                return (
                  <TooltipShell title={String(entry.name)}>
                    <TooltipRow
                      label="Spend"
                      value={formatMinor(amountMinor)}
                      color={String(entry.payload?.fill ?? '')}
                    />
                    <TooltipRow
                      label="Share"
                      value={formatPct(total > 0 ? (amountMinor / total) * 100 : 0)}
                    />
                  </TooltipShell>
                );
              }}
            />
            <Pie
              data={data}
              dataKey="amountMinor"
              nameKey="name"
              innerRadius="58%"
              outerRadius="82%"
              minAngle={4}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              // A 2px gap in the ground colour separates touching segments;
              // never a border drawn around the mark.
              stroke={theme.ground}
              strokeWidth={2}
              paddingAngle={0}
            >
              {data.map((slice, index) => (
                <Cell key={slice.name} fill={colorFor(index)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-centre" aria-hidden="true">
          <span className="donut-total">{formatMinor(total, 0)}</span>
          <span className="donut-caption">
            {slices.length} categor{slices.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
      </div>

      {/* The legend is also the filter: one list, doing identity and
          interaction at once, rather than the same categories printed twice. */}
      <ul className="donut-legend">
        {data.map((slice, index) => {
          const foldedOther = slice.name.startsWith('Other (');
          const isSelected = selected === slice.name;
          const share = total > 0 ? (slice.amountMinor / total) * 100 : 0;
          const row = (
            <>
              <span
                className="donut-swatch"
                style={{ background: colorFor(index) }}
                aria-hidden="true"
              />
              <span className="donut-legend-name">{slice.name}</span>
              <span className="donut-legend-share">{formatPct(share, 0)}</span>
              <span className="donut-legend-value">{formatMinor(slice.amountMinor, 0)}</span>
            </>
          );
          return (
            <li key={slice.name}>
              {onSelect && !foldedOther ? (
                <button
                  type="button"
                  className="donut-legend-button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(isSelected ? null : slice.name)}
                >
                  {row}
                </button>
              ) : (
                <span className="donut-legend-button" data-static="true">
                  {row}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
