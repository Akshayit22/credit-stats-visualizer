'use client';

import { useFormStatus } from 'react-dom';
import { Icon } from './icon';

export function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="account-chip" disabled={pending}>
      <Icon.SignOut size={13} aria-hidden="true" />
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
