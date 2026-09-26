import { Navigate, createBrowserRouter, type RouteObject } from 'react-router';
import { PageLoading } from './components/page-state';
import { AppLayout } from './pages/app-layout';
import { LibraryPage } from './pages/library-page';
import { NotFoundPage } from './pages/not-found-page';
import { SectionPage } from './pages/section-page';
import { SettingsPage } from './pages/settings-page';
import { SignInPage } from './pages/sign-in-page';

/**
 * Every URL the app answers. Periods live in the query string
 * (`?mode=month&period=2026-07`), so a screen is linkable and the back button
 * moves between months.
 *
 * The dashboards load on first visit: they carry the charting library, and
 * the sign-in page should not have to download it.
 */
const dashboards = {
  overview: async () => ({ Component: (await import('./pages/overview-page')).OverviewPage }),
  card: async () => {
    const { AccountPage } = await import('./pages/account-page');
    return { Component: () => <AccountPage screen="card" /> };
  },
  cashback: async () => {
    const { AccountPage } = await import('./pages/account-page');
    return { Component: () => <AccountPage screen="cashback" /> };
  },
  savings: async () => {
    const { AccountPage } = await import('./pages/account-page');
    return { Component: () => <AccountPage screen="savings" /> };
  },
} satisfies Record<string, RouteObject['lazy']>;

export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: <AppLayout />,
    hydrateFallbackElement: <PageLoading />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: '/overview', lazy: dashboards.overview },
      { path: '/accounts', element: <SectionPage section="card" /> },
      { path: '/accounts/:accountId', lazy: dashboards.card },
      { path: '/accounts/:accountId/cashback', lazy: dashboards.cashback },
      { path: '/cashback', element: <SectionPage section="cashback" /> },
      { path: '/savings', element: <SectionPage section="savings" /> },
      { path: '/savings/:accountId', lazy: dashboards.savings },
      { path: '/library', element: <LibraryPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
