import type { ReactNode } from 'react';

/**
 * One tooltip shell for every chart, so hover reads the same everywhere:
 * the point's own label on top, then rows of `name — value`, with the series
 * colour carried by a dot beside the text rather than by the text itself.
 */
export function TooltipShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="chart-tooltip" role="tooltip">
      <div className="chart-tooltip-title">{title}</div>
      {children}
    </div>
  );
}

export function TooltipRow({
  label,
  value,
  color,
  tone,
}: {
  label: string;
  value: string;
  color?: string;
  tone?: 'positive' | 'warning' | 'muted';
}) {
  return (
    <div className="chart-tooltip-row">
      {color && (
        <span className="chart-tooltip-dot" style={{ background: color }} aria-hidden="true" />
      )}
      <span className="chart-tooltip-label">{label}</span>
      <b className={tone ? `is-${tone}` : undefined}>{value}</b>
    </div>
  );
}

export function TooltipEmpty({ title, message }: { title: string; message: string }) {
  return (
    <div className="chart-tooltip" role="tooltip">
      <div className="chart-tooltip-title">{title}</div>
      <div className="chart-tooltip-empty">{message}</div>
    </div>
  );
}
