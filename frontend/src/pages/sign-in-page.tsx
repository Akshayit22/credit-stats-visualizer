import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Icon } from '../components/icon';
import { queryKeys, useAuthConfig, useSession } from '../hooks/queries';
import { ApiError } from '../services/api-client';
import { endpoints } from '../services/endpoints';
import { renderGoogleButton } from '../utils/google-identity';

/**
 * Sign-in: Google, and — outside production, when switched on — a demo user
 * that needs no account. Which of the two appear is the API's decision
 * (`/api/auth/config`), so the page never offers something the server refuses.
 */
export function SignInPage() {
  const session = useSession();
  const config = useAuthConfig();
  const client = useQueryClient();
  const navigate = useNavigate();
  const googleSlot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const googleClientId = config.data?.googleClientId ?? null;
  const devLogin = config.data?.devLoginEnabled ?? false;

  const finishSignIn = async (signIn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
      await client.invalidateQueries({ queryKey: queryKeys.session });
      await navigate('/overview', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That sign-in did not go through. Try again.',
      );
      setBusy(false);
    }
  };

  const onGoogleCredential = useEffectEvent((credential: string) => {
    void finishSignIn(() => endpoints.auth.signInWithGoogle(credential));
  });

  useEffect(() => {
    const slot = googleSlot.current;
    if (!slot || !googleClientId) return;
    renderGoogleButton(slot, googleClientId, onGoogleCredential).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'Google sign-in could not be loaded.');
    });
  }, [googleClientId]);

  if (session.data) return <Navigate to="/overview" replace />;

  return (
    <main className="sign-in">
      <div className="sign-in-card">
        <span className="sidebar-mark" aria-hidden="true" />
        <h1 className="sign-in-title">cred-stats</h1>
        <p className="sign-in-copy">No bank login. Statements are parsed, never stored as files.</p>

        {error && (
          <div className="banner" data-tone="negative" role="alert">
            <span className="banner-body">{error}</span>
          </div>
        )}

        {config.isError && (
          <div className="banner" data-tone="negative" role="alert">
            <span className="banner-body">
              The server could not be reached. Is the API running?
            </span>
          </div>
        )}

        <div className="sign-in-actions" aria-busy={busy}>
          {googleClientId && <div ref={googleSlot} className="sign-in-google" />}
          {devLogin && (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              disabled={busy}
              onClick={() => void finishSignIn(endpoints.auth.signInAsDemoUser)}
            >
              <Icon.ArrowRight size={14} aria-hidden="true" />
              {busy ? 'Signing in…' : 'Continue as the demo user'}
            </button>
          )}
        </div>

        {config.data && !googleClientId && !devLogin && (
          <p className="sign-in-note">
            No sign-in method is configured. Set <code>GOOGLE_CLIENT_ID</code> in the server&rsquo;s
            environment — docs/setup.md says where to get one. For local development,{' '}
            <code>CRED_STATS_DEV_LOGIN=true</code> in <code>backend/.env</code> adds a demo user
            instead.
          </p>
        )}

        {googleClientId && devLogin && (
          <>
            <p className="sign-in-note">
              The demo user is a local development convenience. It is refused in production.
            </p>
            {/* Google reports a missing origin inside its own popup, where the
                app cannot see it — so the fix is spelled out here, locally. */}
            <p className="sign-in-note">
              If Google says <code>origin_mismatch</code>, add <code>{window.location.origin}</code>{' '}
              to this OAuth client&rsquo;s authorised JavaScript origins in Google Cloud Console.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
