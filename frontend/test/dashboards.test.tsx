import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { routes } from '../src/routes';
import { mockApi, renderRoutes } from './helpers/render';
import { CARD_ID, CARD_VIEW, JUNE, OVERVIEW_VIEW, SESSION, WORKSPACE } from './helpers/views';

function api(extra: Record<string, unknown> = {}) {
  return mockApi({
    'GET /api/auth/me': SESSION,
    'GET /api/views/workspace': WORKSPACE,
    'GET /api/views/overview': OVERVIEW_VIEW,
    [`GET /api/views/card/${CARD_ID}`]: CARD_VIEW,
    [`GET /api/views/cashback/${CARD_ID}`]: CARD_VIEW,
    ...extra,
  });
}

describe('the overview', () => {
  it('shows the month’s tiles and the accounts behind them', async () => {
    api();
    renderRoutes(routes, '/overview');

    expect(await screen.findByText('Spend')).toBeInTheDocument();
    expect(screen.getAllByText('₹19,270').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Axis Bank/).length).toBeGreaterThan(0);
  });

  it('warns about a statement that did not reconcile', async () => {
    const needsReview = [{ ...JUNE, status: 'needs_review' as const }];
    api({ 'GET /api/views/overview': { ...OVERVIEW_VIEW, needsReview } });
    renderRoutes(routes, '/overview');
    expect(await screen.findByText(/1 statement did not reconcile/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the library' })).toHaveAttribute(
      'href',
      '/library',
    );
  });
});

describe('the card screen', () => {
  it('shows the cycle’s bill and every row of the statement, including May’s', async () => {
    api();
    renderRoutes(routes, `/accounts/${CARD_ID}?period=2026-06`);

    expect((await screen.findAllByText('Bill')).length).toBeGreaterThan(0);
    expect(screen.getByText('Total due')).toBeInTheDocument();
    expect(screen.getAllByText('₹19,392.38').length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: /Every transaction/ });
    expect(within(table).getByText('Swiggy')).toBeInTheDocument();
    expect(within(table).getByText('25/05')).toBeInTheDocument();
  });

  it('recategorises a row by statement and row id, and remembers the merchant', async () => {
    const fetchSpy = api({
      [`PATCH /api/statements/${JUNE.statementId}/transactions/0001`]: { updated: true },
    });
    renderRoutes(routes, `/accounts/${CARD_ID}?period=2026-06`);

    const table = await screen.findByRole('table', { name: /Every transaction/ });
    await userEvent.click(within(table).getByRole('button', { name: /Groceries/ }));
    await userEvent.selectOptions(within(table).getByRole('combobox'), 'Shopping');

    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        category: 'Shopping',
        applyToMerchant: true,
      });
    });
  });

  it('puts the chosen month in the URL and asks the API for it', async () => {
    const fetchSpy = api();
    renderRoutes(routes, `/accounts/${CARD_ID}?period=2026-06`);

    const month = await screen.findByLabelText('Month');
    await userEvent.selectOptions(month, '2026-05');

    await waitFor(() => {
      const urls = fetchSpy.mock.calls.map(([url]) => String(url));
      expect(urls).toContain(`/api/views/card/${CARD_ID}?period=2026-05`);
    });
  });

  it('shows the API’s not-found for an account that is not a card', async () => {
    api();
    renderRoutes(routes, '/accounts/some-savings-account');
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});

describe('the cashback screen', () => {
  it('shows cashback earned against credited', async () => {
    api();
    renderRoutes(routes, `/accounts/${CARD_ID}/cashback?period=2026-06`);
    expect((await screen.findAllByText(/₹267/)).length).toBeGreaterThan(0);
  });
});
