import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { vi } from 'vitest';

/**
 * Renders routes in memory with a fresh query cache — no retries, so a
 * failure shows up at once.
 */
export function renderRoutes(routes: RouteObject[], initialPath: string): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

export function renderWithProviders(element: ReactElement, path = '/'): RenderResult {
  return renderRoutes([{ path: '*', element }], path);
}

type Handler = (init: RequestInit | undefined) => { status?: number; body: unknown };

/**
 * A fake API: `routes` maps `"GET /api/auth/me"` to what it answers. Unknown
 * routes answer 404 in the API's own error shape. Returns the spy so a test
 * can see what was sent.
 */
export function mockApi(routes: Record<string, Handler | unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    const route = routes[key];
    const answer =
      typeof route === 'function'
        ? (route as Handler)(init)
        : route === undefined
          ? { status: 404, body: { error: { code: 'not_found', message: 'That was not found.' } } }
          : { status: 200, body: { data: route } };
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

export const UNAUTHORISED = () => ({
  status: 401,
  body: { error: { code: 'unauthorised', message: 'Sign in to continue.' } },
});
