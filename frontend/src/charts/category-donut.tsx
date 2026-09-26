import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { formatMinor, formatPct } from '@cred-stats/shared';
import { chartTheme } from './theme';

export interface CategorySlice {
  name: string;
  amountMinor: number;
}

/** Past six slices a ring is unreadable; the rest fold into one "Other". */
const MAX_SLICES = 6;

function foldToTopSlices(slices: CategorySlice[]): CategorySlice[] {
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
 * magnitude order — one hue, light to dark — not a categorical palette: six
 * distinguishable hues do not exist on this ground, and pretending otherwise
 * would give two categories colours nobody can tell apart.
 *
 * Identity therefore never rests on colour. The list beside it names every
 * slice with its share and amount, and is also the filter.
 *
 * **There is no floating tooltip.** One covered most of the ring and printed
 * itself over the total in the middle. The hole is the better place for it:
 * hover a slice — or its row in the list — and the centre becomes that slice,
 * with its name, amount and share, returning to the total when you leave. Same
 * information, nothing occluded, and the hole stops being decoration.
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
  /** Click a slice or a row to filter; the list is also the legend. */
  onSelect?: (category: string | null) => void;
}) {
  const theme = chartTheme();
  const data = foldToTopSlices(slices);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const colorFor = (index: number) =>
    theme.sequential[Math.min(index, theme.sequential.length - 1)] ?? theme.sequential[0];

  const active = activeIndex === null ? null : (data[activeIndex] ?? null);
  const activeShare = active && total > 0 ? (active.amountMinor / total) * 100 : 0;
  const isOther = (name: string) => name.startsWith('Other (');

  return (
    <div className="donut">
      <div className="donut-ring" onMouseLeave={() => setActiveIndex(null)}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amountMinor"
              nameKey="name"
              innerRadius="64%"
              outerRadius="94%"
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
                <Cell
                  key={slice.name}
                  fill={colorFor(index)}
                  // Dim the rest while one is being read, so the slice under
                  // the pointer is unmistakable without changing its colour.
                  fillOpacity={activeIndex === null || activeIndex === index ? 1 : 0.35}
                  style={{ cursor: onSelect && !isOther(slice.name) ? 'pointer' : 'default' }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    if (!onSelect || isOther(slice.name)) return;
                    onSelect(selected === slice.name ? null : slice.name);
                  }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="donut-centre" aria-hidden="true">
          {active ? (
            <>
              <span className="donut-centre-name">{active.name}</span>
              <span className="donut-total">{formatMinor(active.amountMinor, 0)}</span>
              <span className="donut-caption">{formatPct(activeShare, 1)} of spend</span>
            </>
          ) : (
            <>
              <span className="donut-total">{formatMinor(total, 0)}</span>
              <span className="donut-caption">
                {slices.length} categor{slices.length === 1 ? 'y' : 'ies'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* The legend is also the filter: one list, doing identity and
          interaction at once, rather than the same categories printed twice on
          the same screen. Hovering a row lights its slice, so the two read as
          one figure. */}
      <ul className="donut-legend" onMouseLeave={() => setActiveIndex(null)}>
        {data.map((slice, index) => {
          const foldedOther = isOther(slice.name);
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
            <li key={slice.name} onMouseEnter={() => setActiveIndex(index)}>
              {onSelect && !foldedOther ? (
                <button
                  type="button"
                  className="donut-legend-button"
                  aria-pressed={isSelected}
                  onFocus={() => setActiveIndex(index)}
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
