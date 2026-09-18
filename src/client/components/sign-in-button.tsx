'use client';

import { useFormStatus } from 'react-dom';
import { Icon } from './icon';

/**
 * Outlined, never filled — the design system's primary action. Disables itself
 * while the server action is in flight so a double click cannot start two
 * OAuth round trips.
 */
export function SignInButton({ variant }: { variant: 'google' | 'demo' }) {
  const { pending } = useFormStatus();
  const google = variant === 'google';

  return (
    <button
      type="submit"
      className={`btn ${google ? 'btn-primary' : 'btn-secondary'} btn-block`}
      disabled={pending}
    >
      {google ? <Icon.GoogleLogo size={16} aria-hidden="true" /> : null}
      {google
        ? pending
          ? 'Taking you to Google…'
          : 'Continue with Google'
        : pending
          ? 'Signing in…'
          : 'Continue as the demo user'}
    </button>
  );
}
