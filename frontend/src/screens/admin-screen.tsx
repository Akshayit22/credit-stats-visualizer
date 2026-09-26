import type { AdminOverview } from '@cred-stats/shared';
import { StatTile, TileRow } from '../components/stat-tile';

const WHEN = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function when(instant: string | null): string {
  if (!instant) return '—';
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? '—' : WHEN.format(date);
}

/**
 * Who uses the app: every account that has signed in, when they last did, and
 * how many statements they have uploaded for which bank. Counts only — the
 * API never sends anyone else's figures, even to an admin.
 */
export function AdminScreen({ overview }: { overview: AdminOverview }) {
  const { totals, users } = overview;
  const withUploads = users.filter((user) => user.statements > 0).length;

  return (
    <main className="app-main">
      <section className="section is-compact">
        <div className="page-head">
          <div>
            <div className="page-kicker">Admin</div>
            <h1 className="page-title">Users</h1>
          </div>
          <span className="block-sub">as of {when(overview.generatedAt)}</span>
        </div>

        <TileRow>
          <StatTile
            label="Users"
            value={String(totals.users)}
            note={`${withUploads} with statements`}
          />
          <StatTile label="Statements" value={String(totals.statements)} note="across every user" />
          <StatTile label="Accounts" value={String(totals.accounts)} note="cards and savings" />
        </TileRow>

        {users.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">Nobody has signed in yet</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table is-admin">
              <caption className="visually-hidden">
                Every user, most recently signed in first, with their statements per bank.
              </caption>
              <thead>
                <tr>
                  <th>User</th>
                  <th className="col-when">Last signed in</th>
                  <th className="col-when">Joined</th>
                  <th className="num col-rows">Statements</th>
                  <th>Banks</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId}>
                    <td>
                      <div className="cell-merchant">{user.name || '—'}</div>
                      <div className="cell-sub">{user.email}</div>
                    </td>
                    <td className="cell-small">{when(user.lastLoginAt)}</td>
                    <td className="cell-dim">{when(user.createdAt)}</td>
                    <td className="num cell-small">{user.statements}</td>
                    <td>
                      {user.banks.length === 0 ? (
                        <span className="is-muted cell-meta">none uploaded</span>
                      ) : (
                        <ul className="bank-chips">
                          {user.banks.map((bank) => (
                            <li key={`${bank.issuer}-${bank.accountType}`} className="bank-chip">
                              {bank.issuer}
                              <span className="is-muted">
                                {' '}
                                · {bank.accountType === 'savings' ? 'savings' : 'card'} ·{' '}
                              </span>
                              {bank.statements}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
