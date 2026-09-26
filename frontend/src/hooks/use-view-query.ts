import type { ViewQuery } from '@cred-stats/shared';
import { useSearchParams } from 'react-router';

/**
 * Which months a dashboard shows, read from the URL:
 *
 *   ?mode=month&period=2026-07     one month
 *   ?mode=year&year=2026           a calendar year
 *
 * The API resolves anything missing or malformed to the newest month, so this
 * passes the values through untouched.
 */
export function useViewQuery(): ViewQuery {
  const [params] = useSearchParams();
  const query: ViewQuery = {};
  const mode = params.get('mode');
  const period = params.get('period');
  const year = params.get('year');
  if (mode) query.mode = mode;
  if (period) query.period = period;
  if (year) query.year = year;
  return query;
}
