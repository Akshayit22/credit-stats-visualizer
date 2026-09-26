/**
 * Charts are drawn with recharts, which needs real colour strings — a CSS
 * custom property does not resolve inside an SVG presentation attribute. So the
 * tokens stay the single source of truth in `app/globals.css` and are *read*
 * from there at runtime, rather than being duplicated as hex in TypeScript.
 *
 * Charts never render on the server (see `useMounted`), so there is no
 * hydration mismatch to worry about and no fallback palette to keep in step.
 */

export interface ChartTheme {
  series: [string, string, string];
  sequential: string[];
  positive: string;
  warning: string;
  negative: string;
  grid: string;
  axis: string;
  axisText: string;
  crosshair: string;
  surface: string;
  ground: string;
  text: string;
  font: string;
}

let cached: ChartTheme | null = null;

function token(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

export function chartTheme(): ChartTheme {
  if (cached) return cached;
  const style = getComputedStyle(document.documentElement);
  cached = {
    series: [token(style, '--series-1'), token(style, '--series-2'), token(style, '--series-3')],
    sequential: [
      token(style, '--seq-1'),
      token(style, '--seq-2'),
      token(style, '--seq-3'),
      token(style, '--seq-4'),
      token(style, '--seq-5'),
      token(style, '--seq-6'),
    ],
    positive: token(style, '--color-positive'),
    warning: token(style, '--color-warning'),
    negative: token(style, '--color-negative'),
    grid: token(style, '--chart-grid'),
    axis: token(style, '--chart-axis'),
    axisText: token(style, '--chart-axis-text'),
    crosshair: token(style, '--chart-crosshair'),
    surface: token(style, '--color-surface'),
    ground: token(style, '--color-bg'),
    text: token(style, '--color-text'),
    font: token(style, '--font-body'),
  };
  return cached;
}

/** The series roles this app uses, named rather than indexed. */
export type SeriesRole = 'primary' | 'good' | 'cost';

export function seriesColor(theme: ChartTheme, role: SeriesRole): string {
  if (role === 'good') return theme.series[1];
  if (role === 'cost') return theme.series[2];
  return theme.series[0];
}

/** A hue at ~10% for an area wash — a wash, never a saturated block. */
export function wash(color: string): string {
  return `color-mix(in srgb, ${color} 10%, transparent)`;
}
