import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { queryKeys } from './hooks/queries';
import { router } from './routes';
import { ApiError } from './services/api-client';
import './styles/index.css';

/**
 * Statements change only when the user uploads or edits one, and every such
 * change invalidates what it affects, so answers stay fresh for a minute and
 * a window regaining focus does not refetch everything.
 *
 * A 401 from any request means the session ended (it expired, or the account
 * was deleted elsewhere): the session is re-checked, and the layout sends the
 * user to sign in.
 */
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const isSessionCheck = query.queryKey[0] === queryKeys.session[0];
      if (error instanceof ApiError && error.isUnauthorised && !isSessionCheck) {
        void queryClient.resetQueries({ queryKey: queryKeys.session });
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
        failureCount < 2,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
