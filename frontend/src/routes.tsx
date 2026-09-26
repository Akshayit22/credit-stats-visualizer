import { Navigate, createBrowserRouter } from 'react-router';
import { AppLayout } from './pages/app-layout';
import { NotFoundPage } from './pages/not-found-page';
import { SignInPage } from './pages/sign-in-page';

/**
 * Every URL the app answers. Periods live in the query string
 * (`?mode=month&period=2026-07`), so a screen is linkable and the back button
 * moves between months.
 */
export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignInPage /> },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
