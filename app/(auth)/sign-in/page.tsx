import { redirect } from 'next/navigation';
import { devLoginEnabled, googleConfigured, signIn } from '@/server/auth/config';
import { getSessionUser } from '@/server/auth/session';
import { SignInButton } from '@/client/components/sign-in-button';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, user] = await Promise.all([searchParams, getSessionUser()]);
  if (user) redirect('/overview');

  const withGoogle = googleConfigured();
  const withDevLogin = devLoginEnabled();

  async function continueWithGoogle() {
    'use server';
    await signIn('google', { redirectTo: '/overview' });
  }

  async function continueAsDemoUser() {
    'use server';
    await signIn('dev-login', { redirectTo: '/overview' });
  }

  return (
    <main className="sign-in">
      <div className="sign-in-card">
        <span className="sidebar-mark" aria-hidden="true" />
        <h1 className="sign-in-title">cred-stats</h1>
        <p className="sign-in-copy">
          No bank login. Statements are parsed, never stored as files.
        </p>

        {error && (
          <div className="banner" data-tone="negative" role="alert">
            <span className="banner-body">
              That sign-in did not go through. Check the redirect URI in Google Cloud Console
              matches <code>/api/auth/callback/google</code>, then try again.
            </span>
          </div>
        )}

        <div className="sign-in-actions">
          {withGoogle && (
            <form action={continueWithGoogle}>
              <SignInButton variant="google" />
            </form>
          )}
          {withDevLogin && (
            <form action={continueAsDemoUser}>
              <SignInButton variant="demo" />
            </form>
          )}
        </div>

        {!withGoogle && !withDevLogin && (
          <p className="sign-in-note">
            No sign-in method is configured. Set <code>GOOGLE_CLIENT_ID</code> and{' '}
            <code>GOOGLE_CLIENT_SECRET</code>, or <code>CRED_STATS_DEV_LOGIN=true</code> for the
            demo user. SETUP.md §2 walks through both.
          </p>
        )}

        {withGoogle && withDevLogin && (
          <p className="sign-in-note">
            The demo user is a local development bypass. It is refused in production.
          </p>
        )}
      </div>
    </main>
  );
}
