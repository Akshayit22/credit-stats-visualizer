import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { RecategoriseRequest, StatementUploadPayload, ViewQuery } from '@cred-stats/shared';
import { endpoints, type AccountScreen } from '../services/endpoints';

/**
 * Query keys. Everything derived from the user's statements sits under `data`,
 * so one invalidation after an upload, a recategorise or a delete refreshes
 * every screen — the SPA equivalent of re-rendering the page on the server.
 */
export const queryKeys = {
  authConfig: ['auth', 'config'] as const,
  session: ['auth', 'session'] as const,
  data: ['data'] as const,
  workspace: ['data', 'workspace'] as const,
  overview: (query: ViewQuery) => ['data', 'overview', query] as const,
  account: (screen: AccountScreen, accountId: string, query: ViewQuery) =>
    ['data', 'account', screen, accountId, query] as const,
  library: ['data', 'library'] as const,
  settings: ['data', 'settings'] as const,
};

export function refreshData(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.data });
}

/* ── reads ─────────────────────────────────────────────────────────────── */

export function useAuthConfig() {
  return useQuery({ queryKey: queryKeys.authConfig, queryFn: endpoints.auth.config });
}

/** The signed-in user. A 401 is an answer here ("nobody"), not an error to retry. */
export function useSession() {
  return useQuery({ queryKey: queryKeys.session, queryFn: endpoints.auth.me, retry: false });
}

export function useWorkspace() {
  return useQuery({ queryKey: queryKeys.workspace, queryFn: endpoints.views.workspace });
}

export function useOverview(query: ViewQuery) {
  return useQuery({
    queryKey: queryKeys.overview(query),
    queryFn: () => endpoints.views.overview(query),
  });
}

export function useAccountView(screen: AccountScreen, accountId: string, query: ViewQuery) {
  return useQuery({
    queryKey: queryKeys.account(screen, accountId, query),
    queryFn: () => endpoints.views.account(screen, accountId, query),
  });
}

export function useLibrary() {
  return useQuery({ queryKey: queryKeys.library, queryFn: endpoints.statements.library });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: endpoints.profile.settings });
}

/* ── writes ────────────────────────────────────────────────────────────── */

export function useUploadStatement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: StatementUploadPayload) => endpoints.statements.upload(payload),
    onSuccess: () => refreshData(client),
  });
}

export function useRecategorise() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { statementId: string; txnId: string; change: RecategoriseRequest }) =>
      endpoints.statements.recategorise(args.statementId, args.txnId, args.change),
    onSuccess: () => refreshData(client),
  });
}

export function useDeleteStatement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (statementId: string) => endpoints.statements.remove(statementId),
    onSuccess: () => refreshData(client),
  });
}

/** Deleting everything also ends the session, so every cached answer goes. */
export function useDeleteProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.profile.remove({ confirm: 'delete my data' }),
    onSuccess: () => client.clear(),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: endpoints.auth.signOut,
    onSettled: () => client.clear(),
  });
}
