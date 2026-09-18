'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { Account, Period } from '@/shared/types';
import { formatPeriodLabel } from '@/client/lib/format';
import { Icon } from './icon';
import { UploadDialog } from './upload-dialog';

export type PeriodMode = 'month' | 'year' | 'range';

export interface HeaderProps {
  accounts: Account[];
  /** Months this screen can switch between, oldest first. */
  availablePeriods: Period[];
  /** Months that actually have a statement (the rest render as dashed chips). */
  periodsWithData: Period[];
  selectedPeriod: Period;
  mode: PeriodMode;
  /** Which accounts the pills should offer — the screen decides. */
  accountScope: 'all' | 'credit_card' | 'savings';
  selectedAccountId: string | null;
  coverage: { have: number; total: number; missing: string[] };
}

/**
 * The sticky header from the v2 mockup: account pills, the Month / Year / Range
 * switcher, the month strip, a coverage note and the Upload button.
 *
 * All of its state lives in the URL, so a period is linkable and the back
 * button does what it should.
 */
export function AppHeader(props: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);

  /**
   * Twelve month chips overflow the header on any normal screen, and the
   * selected one is usually the newest — the far right. A callback ref scrolls
   * it into view as it mounts, so the strip opens where the reader is looking.
   */
  const selectedChipRef = useCallback((node: HTMLButtonElement | null) => {
    node?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);

  const pills = props.accounts.filter(
    (account) => props.accountScope === 'all' || account.type === props.accountScope,
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  };

  const hrefForAccount = (account: Account): string => {
    const base =
      account.type === 'savings' ? `/savings/${account.accountId}` : `/accounts/${account.accountId}`;
    const next = new URLSearchParams(searchParams.toString());
    return `${base}?${next.toString()}`;
  };

  const complete = props.coverage.have === props.coverage.total;

  return (
    <>
      <header className="app-header">
        {pills.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            {pills.map((account) => (
              <Link
                key={account.accountId}
                href={hrefForAccount(account)}
                className="pill"
                aria-current={account.accountId === props.selectedAccountId ? 'page' : undefined}
              >
                {account.type === 'savings' ? (
                  <Icon.Bank size={13} aria-hidden="true" />
                ) : (
                  <Icon.CreditCard size={13} aria-hidden="true" />
                )}
                <span style={{ whiteSpace: 'nowrap' }}>{shortName(account)}</span>
              </Link>
            ))}
          </div>
        )}

        {pills.length > 1 && <div className="header-rule" aria-hidden="true" />}

        <div className="seg" role="group" aria-label="Period">
          {(['month', 'year'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="seg-btn"
              aria-pressed={props.mode === mode}
              onClick={() => setParam('mode', mode)}
            >
              {mode === 'month' ? 'Month' : 'Year'}
            </button>
          ))}
        </div>

        {props.mode === 'month' ? (
          <div className="month-strip" role="group" aria-label="Month">
            {props.availablePeriods.map((period) => {
              const hasData = props.periodsWithData.includes(period);
              return (
                <button
                  key={period}
                  ref={period === props.selectedPeriod ? selectedChipRef : undefined}
                  type="button"
                  className="month-chip"
                  data-empty={!hasData}
                  aria-pressed={period === props.selectedPeriod}
                  title={`${formatPeriodLabel(period)} · ${hasData ? 'uploaded' : 'no statement'}`}
                  onClick={() => {
                    if (hasData) setParam('period', period);
                    else setUploadOpen(true);
                  }}
                >
                  {formatPeriodLabel(period)}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ flex: '1 1 200px', minWidth: 160 }}>
            <label className="visually-hidden" htmlFor="year-select">
              Year
            </label>
            <select
              id="year-select"
              className="input"
              style={{ width: 'auto', minWidth: 150, fontSize: 12.5 }}
              value={props.selectedPeriod.slice(0, 4)}
              onChange={(event) => setParam('year', event.target.value)}
            >
              {yearsIn(props.availablePeriods).map((year) => (
                <option key={year} value={year}>
                  Calendar {year}
                </option>
              ))}
            </select>
          </div>
        )}

        <div
          className="header-spacer"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap)' }}
        >
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
            className="btn btn-primary"
            style={{ flex: 'none' }}
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

function shortName(account: Account): string {
  if (account.type === 'savings') return `${account.issuer.split(' ')[0]} savings`;
  const product = account.productName.replace(/credit card/i, '').trim();
  return product.length > 0 ? product : account.issuer;
}

function yearsIn(periods: Period[]): string[] {
  const years = [...new Set(periods.map((period) => period.slice(0, 4)))].sort();
  return years.length > 0 ? years : [String(new Date().getUTCFullYear())];
}
