import type { StatTileProps } from '../components/stat-tile';

/** The percentage change between two months, or null when there is no prior. */
export function deltaBetween(
  current: number,
  previous: number | null,
  options: { goodWhenDown?: boolean; previousLabel: string },
): StatTileProps['delta'] {
  if (previous === null) return undefined;
  if (previous === 0) {
    return {
      text: current > 0 ? 'new' : 'nil',
      direction: current > 0 ? 'up' : 'flat',
      good: options.goodWhenDown ? current === 0 : current > 0,
      note: `none in ${options.previousLabel}`,
    };
  }
  const change = ((current - previous) / previous) * 100;
  const up = change >= 0;
  return {
    text: `${up ? '+' : '−'}${Math.abs(change).toFixed(1)}%`,
    direction: up ? 'up' : 'down',
    good: options.goodWhenDown ? !up : up,
    note: `vs ${options.previousLabel}`,
  };
}
