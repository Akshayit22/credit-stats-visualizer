import { useSyncExternalStore } from 'react';

/**
 * True once the component is in the page. recharts measures its container and
 * the chart palette is read from the live CSS custom properties, so a chart is
 * drawn only when mounted; until then a placeholder of the right height keeps
 * the layout from jumping.
 */
const noop = () => () => {};
const mounted = () => true;
const notMounted = () => false;

export function useMounted(): boolean {
  return useSyncExternalStore(noop, mounted, notMounted);
}
