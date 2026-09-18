'use client';

import { useSyncExternalStore } from 'react';

/**
 * Charts mount client-side only. recharts needs to measure its container, and
 * the palette is read from the live CSS custom properties, so there is nothing
 * useful to render on the server — a placeholder of the right height keeps the
 * layout from jumping and keeps hydration honest.
 */
const noop = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function useMounted(): boolean {
  return useSyncExternalStore(noop, onClient, onServer);
}

export interface ChartBlockProps {
  title: string;
  /** A short line under the title — period, units, how to read it. */
  subtitle?: string;
  /** The series colour, drawn as the short mark beside the title. */
  markColor?: string;
  /** Right-aligned figures: total, average, peak. */
  stats?: Array<{ label: string; value: string }>;
  /**
   * A fixed plot height, or `auto` for a figure that sizes itself — the
   * category ring plus its list is taller on a phone than on a desktop, and
   * pinning it clips the list into whatever comes next.
   */
  height: number | 'auto';
  children: React.ReactNode;
}

/**
 * The block header from the mockup: a short accent mark, the title, a muted
 * subtitle, and the totals on the right. A single-series chart carries no
 * legend — the title already names what is plotted.
 */
export function ChartBlock({
  title,
  subtitle,
  markColor,
  stats,
  height,
  children,
}: ChartBlockProps) {
  const mounted = useMounted();

  return (
    <section className="block">
      <div className="block-head">
        <div className="block-head-left">
          {markColor && (
            <span className="series-mark" style={{ background: markColor }} aria-hidden="true" />
          )}
          <h3 className="block-title">{title}</h3>
          {subtitle && <span className="block-sub">{subtitle}</span>}
        </div>
        {stats && stats.length > 0 && (
          <div className="block-stats">
            {stats.map((stat) => (
              <span key={stat.label}>
                {stat.label} <b>{stat.value}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ width: '100%', minWidth: 0, ...(height === 'auto' ? {} : { height }) }}>
        {mounted ? (
          children
        ) : (
          <div className="skeleton" style={{ width: '100%', height: height === 'auto' ? 240 : height }} />
        )}
      </div>
    </section>
  );
}
