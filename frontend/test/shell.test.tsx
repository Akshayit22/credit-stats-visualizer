import type { Account } from '@cred-stats/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppLayout } from '../src/pages/app-layout';
import { SignInPage } from '../src/pages/sign-in-page';
import { UNAUTHORISED, mockApi, renderRoutes } from './helpers/render';

const DEMO = {
  userId: 'u'.repeat(32),
  email: 'demo@cred-stats.local',
  name: 'Demo user',
  avatarUrl: '',
};

const CARD: Account = {
  accountId: 'axis-bank-credit-card-9581',
  type: 'credit_card',
  issuer: 'Axis Bank',
  productName: 'Supermoney RuPay Credit Card',
  displayName: 'Axis Bank · Supermoney RuPay Credit Card',
  last4: '9581',
  maskedNumber: 'XXXX9581',
  creditLimitMinor: null,
  cashLimitMinor: null,
  openedAt: null,
  createdAt: '2026-06-20T00:00:00.000Z',
};

const routes = [
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: <AppLayout />,
    children: [{ path: '/overview', element: <p>overview screen</p> }],
  },
];

describe('signing in', () => {
  it('offers only what the server allows, and signs in as the demo user', async () => {
    let signedIn = false;
    mockApi({
      'GET /api/auth/config': { googleClientId: null, devLoginEnabled: true },
      'GET /api/auth/me': () => (signedIn ? { body: { data: DEMO } } : UNAUTHORISED()),
      'POST /api/auth/dev-login': () => {
        signedIn = true;
        return { body: { data: DEMO } };
      },
      'GET /api/views/workspace': { accounts: [], statements: [], periods: [], needsReview: [] },
    });

    renderRoutes(routes, '/sign-in');
    await userEvent.click(await screen.findByRole('button', { name: /demo user/i }));

    expect(await screen.findByText('overview screen')).toBeInTheDocument();
    expect(screen.getByText(/Signed in as demo@cred-stats.local/)).toBeInTheDocument();
  });

  it('says so when no sign-in method is configured', async () => {
    mockApi({
      'GET /api/auth/config': { googleClientId: null, devLoginEnabled: false },
      'GET /api/auth/me': UNAUTHORISED,
    });
    renderRoutes(routes, '/sign-in');
    expect(await screen.findByText(/No sign-in method is configured/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /demo user/i })).not.toBeInTheDocument();
  });
});

describe('the signed-in frame', () => {
  it('sends someone without a session to sign in', async () => {
    mockApi({
      'GET /api/auth/me': UNAUTHORISED,
      'GET /api/auth/config': { googleClientId: null, devLoginEnabled: true },
    });
    renderRoutes(routes, '/overview');
    expect(await screen.findByRole('heading', { name: 'cred-stats' })).toBeInTheDocument();
  });

  it('lists the user’s accounts in the sidebar, bank first', async () => {
    mockApi({
      'GET /api/auth/me': DEMO,
      'GET /api/views/workspace': {
        accounts: [CARD],
        statements: [],
        periods: ['2026-06'],
        needsReview: [],
      },
    });
    renderRoutes(routes, '/overview');

    const link = await screen.findByRole('link', { name: /Axis Bank/ });
    expect(link).toHaveAttribute('href', `/accounts/${CARD.accountId}?period=2026-06`);
    expect(screen.getByText(/Supermoney RuPay XXXX9581/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cashback' })).toBeInTheDocument();
  });
});

describe('requests before a session exists', () => {
  it('does not ask for the workspace until the session is known', async () => {
    const fetchSpy = mockApi({
      'GET /api/auth/me': UNAUTHORISED,
      'GET /api/auth/config': { googleClientId: null, devLoginEnabled: true },
    });
    renderRoutes(routes, '/overview');
    await screen.findByRole('heading', { name: 'cred-stats' });

    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls).not.toContain('/api/views/workspace');
  });
});
