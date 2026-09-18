import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { upsertUserOnSignIn } from '@/server/db/repositories/users';
import { userIdFromSubject } from './user-id';

/**
 * The demo identity the dev-login bypass signs in as. It is a fixed subject so
 * the seeded data always belongs to it.
 */
export const DEV_USER = {
  subject: 'dev-login',
  email: 'demo@cred-stats.local',
  name: 'Demo user',
} as const;

export const DEV_USER_ID = userIdFromSubject(DEV_USER.subject);

/**
 * True only when the bypass is explicitly on *and* we are not in production.
 * Both halves matter: the flag alone must never be enough in a deployed build.
 */
export function devLoginEnabled(): boolean {
  return process.env.CRED_STATS_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function buildProviders(): NextAuthConfig['providers'] {
  const providers: NextAuthConfig['providers'] = [];

  if (googleConfigured()) {
    providers.push(
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: false,
      }),
    );
  }

  if (devLoginEnabled()) {
    providers.push(
      Credentials({
        id: 'dev-login',
        name: 'Demo user',
        credentials: {},
        authorize() {
          // Re-checked here, not just at construction: the process could have
          // been started for development and promoted afterwards.
          if (!devLoginEnabled()) return null;
          return { id: DEV_USER.subject, email: DEV_USER.email, name: DEV_USER.name };
        },
      }),
    );
  }

  return providers;
}

export const authConfig: NextAuthConfig = {
  providers: buildProviders(),
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/sign-in', error: '/sign-in' },
  trustHost: true,
  callbacks: {
    /**
     * First point at which we know who this is. The user row is upserted here
     * rather than through a database adapter, which keeps the five tables free
     * of Auth.js's own session and account tables.
     */
    async signIn({ user, account }) {
      const subject = account?.providerAccountId ?? user.id;
      if (!subject) return false;
      await upsertUserOnSignIn({
        userId: userIdFromSubject(subject),
        email: user.email ?? '',
        name: user.name ?? '',
        avatarUrl: user.image ?? '',
      });
      return true;
    },

    jwt({ token, account, user }) {
      const subject = account?.providerAccountId ?? user?.id ?? token.sub;
      if (subject && !token.credStatsUserId) {
        token.credStatsUserId = userIdFromSubject(subject);
      }
      return token;
    },

    session({ session, token }) {
      if (typeof token.credStatsUserId === 'string') {
        session.user.id = token.credStatsUserId;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
