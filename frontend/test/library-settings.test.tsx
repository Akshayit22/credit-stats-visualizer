import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { routes } from '../src/routes';
import { UNAUTHORISED, mockApi, renderRoutes } from './helpers/render';
import { CARD, JUNE, SESSION, WORKSPACE } from './helpers/views';

const SETTINGS = {
  email: 'demo@cred-stats.local',
  currency: 'INR',
  locale: 'en-IN',
  statementCount: 1,
  accountCount: 1,
  provider: {
    id: 'groq',
    modelId: 'openai/gpt-oss-120b',
    configured: false,
    missing: ['GROQ_API_KEY'],
    note: 'This provider is selected but not configured.',
  },
};

describe('the statement library', () => {
  it('lists each statement with its account, status and a link to it', async () => {
    mockApi({
      'GET /api/auth/me': SESSION,
      'GET /api/views/workspace': WORKSPACE,
      'GET /api/statements': { statements: [JUNE], accounts: [CARD] },
    });
    renderRoutes(routes, '/library');

    const table = await screen.findByRole('table', { name: /Every statement/ });
    expect(within(table).getByText('Axis Bank')).toBeInTheDocument();
    expect(within(table).getByText('17 May – 15 Jun 2026')).toBeInTheDocument();
    expect(within(table).getByText('parsed')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      `/accounts/${CARD.accountId}?period=2026-06`,
    );
    expect(screen.getByRole('link', { name: 'Export data' })).toHaveAttribute(
      'href',
      '/api/profile/export',
    );
  });

  it('deletes one statement by its id', async () => {
    const fetchSpy = mockApi({
      'GET /api/auth/me': SESSION,
      'GET /api/views/workspace': WORKSPACE,
      'GET /api/statements': { statements: [JUNE], accounts: [CARD] },
      [`DELETE /api/statements/${JUNE.statementId}`]: { deleted: true, rowsRemoved: 3 },
    });
    renderRoutes(routes, '/library');

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    );
  });
});

describe('settings', () => {
  it('shows the provider and what it is missing, never a key', async () => {
    mockApi({
      'GET /api/auth/me': SESSION,
      'GET /api/views/workspace': WORKSPACE,
      'GET /api/settings': SETTINGS,
    });
    renderRoutes(routes, '/settings');

    expect(await screen.findByText('groq')).toBeInTheDocument();
    expect(screen.getByText('missing GROQ_API_KEY')).toBeInTheDocument();
    expect(screen.getByText('1 statement across 1 account')).toBeInTheDocument();
  });

  it('deletes everything only after a second click, then signs out', async () => {
    let deleted = false;
    const fetchSpy = mockApi({
      'GET /api/auth/me': () => (deleted ? UNAUTHORISED() : { body: { data: SESSION } }),
      'GET /api/auth/config': { googleClientId: null, devLoginEnabled: true },
      'GET /api/views/workspace': WORKSPACE,
      'GET /api/settings': SETTINGS,
      'POST /api/profile/delete': () => {
        deleted = true;
        return { body: { data: { deleted: {} } } };
      },
    });
    renderRoutes(routes, '/settings');

    await userEvent.click(await screen.findByRole('button', { name: 'Delete all my data' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be undone/);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete everything' }));

    expect(await screen.findByRole('heading', { name: 'cred-stats' })).toBeInTheDocument();
    const post = fetchSpy.mock.calls.find(([url]) => String(url) === '/api/profile/delete');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ confirm: 'delete my data' });
  });
});
