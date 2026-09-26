import type { SettingsView } from '@cred-stats/shared';
import { DeleteAllData } from '../components/delete-all-data';
import { endpoints } from '../services/endpoints';

/** Who is signed in, which AI provider the server uses, and what is kept. */
export function SettingsScreen({
  email,
  currency,
  locale,
  statementCount,
  accountCount,
  provider,
}: SettingsView) {
  return (
    <main className="app-main">
      <section className="section is-compact">
        <div className="page-head">
          <div>
            <div className="page-kicker">Settings</div>
            <h1 className="page-title">Your account</h1>
          </div>
        </div>

        <section className="block">
          <div className="block-head">
            <h2 className="block-title">Account</h2>
          </div>
          <dl className="settings-list">
            <Row label="Signed in as" value={email} />
            <Row label="Currency" value={currency} />
            <Row label="Locale" value={locale} />
            <Row
              label="Held for you"
              value={`${statementCount} statement${statementCount === 1 ? '' : 's'} across ${accountCount} account${accountCount === 1 ? '' : 's'}`}
            />
          </dl>
        </section>

        <section className="block">
          <div className="block-head">
            <h2 className="block-title">AI provider</h2>
            <span className="block-sub">read-only — set with API keys on the server, not here</span>
          </div>
          <dl className="settings-list">
            <Row label="Provider" value={provider.id} />
            <Row label="Model" value={provider.modelId || 'not set'} />
            <Row
              label="Status"
              value={provider.configured ? 'configured' : `missing ${provider.missing.join(', ')}`}
              tone={provider.configured ? 'is-positive' : 'is-warning'}
            />
          </dl>
          <p className="settings-note">{provider.note}</p>
        </section>

        <section className="block">
          <div className="block-head">
            <h2 className="block-title">What is kept</h2>
          </div>
          <p className="settings-note">
            Statement PDFs are unlocked and read in your browser and then discarded. The password
            never leaves your browser. Only the extracted figures are stored, with account numbers
            reduced to their last four digits, and the holder&rsquo;s name, address, phone, email
            and customer id removed before anything is saved.
          </p>
          <div className="action-row">
            <a className="btn btn-secondary" href={endpoints.profile.exportUrl} download>
              Export everything as JSON
            </a>
            <DeleteAllData />
          </div>
        </section>
      </section>
    </main>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="settings-row">
      <dt className="tile-label">{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  );
}
