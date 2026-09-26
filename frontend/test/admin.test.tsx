import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routes } from '../src/routes';
import { mockApi, renderRoutes } from './helpers/render';
import { SESSION, WORKSPACE } from './helpers/views';

const OVERVIEW = {
  generatedAt: '2026-09-26T10:00:00.000Z',
  totals: { users: 2, statements: 3, accounts: 2 },
  users: [
    {
      userId: 'a'.repeat(32),
      email: 'priya@example.com',
      name: 'Priya',
      createdAt: '2026-06-20T10:00:00.000Z',
      lastLoginAt: '2026-09-25T09:00:00.000Z',
      statements: 3,
      lastUploadAt: '2026-08-02T10:00:00.000Z',
      banks: [
        { issuer: 'slice small finance bank', accountType: 'savings', statements: 2 },
        { issuer: 'Axis Bank', accountType: 'credit_card', statements: 1 },
      ],
    },
    {
      userId: 'b'.repeat(32),
      email: 'ravi@example.com',
      name: 'Ravi',
      createdAt: '2026-09-01T10:00:00.000Z',
      lastLoginAt: '2026-09-01T10:00:00.000Z',
      statements: 0,
      lastUploadAt: null,
      banks: [],
    },
  ],
};

describe('the admin overview', () => {
  it('is linked from the sidebar for an admin, and lists users with their banks', async () => {
    mockApi({
      'GET /api/auth/me': { ...SESSION, isAdmin: true },
      'GET /api/views/workspace': WORKSPACE,
      'GET /api/admin/overview': OVERVIEW,
    });
    renderRoutes(routes, '/admin');

    const table = await screen.findByRole('table', { name: /Every user/ });
    expect(within(table).getByText('priya@example.com')).toBeInTheDocument();
    expect(within(table).getByText(/Axis Bank/)).toBeInTheDocument();
    expect(within(table).getByText('none uploaded')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('is not linked for anyone else, and the API’s refusal is shown if visited', async () => {
    mockApi({
      'GET /api/auth/me': { ...SESSION, isAdmin: false },
      'GET /api/views/workspace': WORKSPACE,
      'GET /api/admin/overview': () => ({
        status: 403,
        body: { error: { code: 'forbidden', message: 'This page is for the site’s admins.' } },
      }),
    });
    renderRoutes(routes, '/admin');

    expect(await screen.findByText('This page is for the site’s admins.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });
});
