import type {
  AccountView,
  AdminOverview,
  AuthConfig,
  DeleteProfileRequest,
  OverviewView,
  ParsedStatementResult,
  ProfileDeleted,
  RecategoriseRequest,
  SessionUser,
  SettingsView,
  StatementDeleted,
  StatementLibrary,
  StatementUploadPayload,
  ViewQuery,
  WorkspaceView,
} from '@cred-stats/shared';
import { api } from './api-client';

/**
 * Every API endpoint the app calls, typed with the contracts from
 * `@cred-stats/shared`. Screens never build a URL themselves.
 */

export type AccountScreen = 'card' | 'savings' | 'cashback';

function queryString(query: ViewQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value.length > 0) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const endpoints = {
  auth: {
    config: () => api.get<AuthConfig>('/auth/config'),
    me: () => api.get<SessionUser>('/auth/me'),
    signInWithGoogle: (credential: string) =>
      api.post<SessionUser>('/auth/google', { credential }),
    signInAsDemoUser: () => api.post<SessionUser>('/auth/dev-login'),
    signOut: () => api.post<{ signedOut: true }>('/auth/sign-out'),
  },

  views: {
    workspace: () => api.get<WorkspaceView>('/views/workspace'),
    overview: (query: ViewQuery) => api.get<OverviewView>(`/views/overview${queryString(query)}`),
    account: (screen: AccountScreen, accountId: string, query: ViewQuery) =>
      api.get<AccountView>(
        `/views/${screen}/${encodeURIComponent(accountId)}${queryString(query)}`,
      ),
  },

  statements: {
    library: () => api.get<StatementLibrary>('/statements'),
    upload: (payload: StatementUploadPayload) =>
      api.post<ParsedStatementResult>('/statements', payload),
    remove: (statementId: string) =>
      api.delete<StatementDeleted>(`/statements/${encodeURIComponent(statementId)}`),
    recategorise: (statementId: string, txnId: string, change: RecategoriseRequest) =>
      api.patch<{ updated: true }>(
        `/statements/${encodeURIComponent(statementId)}/transactions/${encodeURIComponent(txnId)}`,
        change,
      ),
  },

  admin: {
    overview: () => api.get<AdminOverview>('/admin/overview'),
  },

  profile: {
    settings: () => api.get<SettingsView>('/settings'),
    remove: (body: DeleteProfileRequest) => api.post<ProfileDeleted>('/profile/delete', body),
    /** A plain link: the browser downloads it with the session cookie. */
    exportUrl: '/api/profile/export',
  },
};
