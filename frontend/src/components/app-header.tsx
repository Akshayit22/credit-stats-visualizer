import { formatPeriodLabel, type Period } from '@cred-stats/shared';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from './icon';
import { UploadDialog } from './upload-dialog';

export type PeriodMode = 'month' | 'year';

export interface HeaderProps {
  /** What this screen is showing, e.g. the account name. Named, not guessed. */
  title: string;
  /** Months this screen can switch between, oldest first. */
  availablePeriods: Period[];
  /** Months that actually have a statement. */
  periodsWithData: Period[];
  selectedPeriod: Period;
  mode: PeriodMode;
  coverage: { have: number; total: number; missing: string[] };
}

/**
 * The sticky header: what you are looking at, when, and the way to add more.
 *
 * The month used to be a strip of twelve chips that overflowed on any normal
 * screen and put the newest month — the one you almost always want — off the
 * right edge. It is a dropdown now: one control, always fully visible, and it
 * can say "no statement" beside a month rather than relying on a dashed border
 * nobody decodes.
 *
 * All of its state lives in the URL, so a period is linkable and the back
 * button does what it should.
 */
export function AppHeader(props: HeaderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);
  const periodId = useId();
  const yearId = useId();

  const setParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) next.set(key, value);
    setSearchParams(next);
  };

  const complete = props.coverage.have === props.coverage.total;
  const years = [...new Set(props.availablePeriods.map((period) => period.slice(0, 4)))].sort();

  return (
    <>
      <header className="app-header">
        <h2 className="header-title">{props.title}</h2>

        <div className="header-controls">
          <div className="seg" role="group" aria-label="Period">
            {(['month', 'year'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className="seg-btn"
                aria-pressed={props.mode === mode}
                onClick={() => setParams({ mode })}
              >
                {mode === 'month' ? 'Month' : 'Year'}
              </button>
            ))}
          </div>

          {props.mode === 'month' ? (
            <div className="field field-inline">
              <label htmlFor={periodId}>Month</label>
              <select
                id={periodId}
                className="input"
                value={props.selectedPeriod}
                onChange={(event) => setParams({ period: event.target.value })}
              >
                {/* Newest first: it is what you want nine times out of ten. */}
                {[...props.availablePeriods].reverse().map((period) => {
                  const hasData = props.periodsWithData.includes(period);
                  return (
                    <option key={period} value={period}>
                      {formatPeriodLabel(period)}
                      {hasData ? '' : ' — no statement'}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <div className="field field-inline">
              <label htmlFor={yearId}>Year</label>
              <select
                id={yearId}
                className="input"
                value={props.selectedPeriod.slice(0, 4)}
                onChange={(event) => setParams({ year: event.target.value })}
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="header-spacer">
          <span
            className="coverage"
            title={
              props.coverage.missing.length > 0
                ? `No statement for ${props.coverage.missing.join(', ')}`
                : 'Complete coverage'
            }
          >
            <span className="coverage-dot" data-partial={!complete} aria-hidden="true" />
            <span className="coverage-label">
              {props.coverage.have} of {props.coverage.total} months
            </span>
          </span>
          <button
            type="button"
            className="btn btn-primary header-upload"
            onClick={() => setUploadOpen(true)}
          >
            <Icon.UploadSimple size={14} aria-hidden="true" />
            Upload
          </button>
        </div>
      </header>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        periodHint={formatPeriodLabel(props.selectedPeriod)}
      />
    </>
  );
}
