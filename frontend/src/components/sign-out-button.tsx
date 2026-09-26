import { useNavigate } from 'react-router';
import { useSignOut } from '../hooks/queries';
import { Icon } from './icon';

export function SignOutButton() {
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className="account-chip"
      disabled={signOut.isPending}
      onClick={() =>
        signOut.mutate(undefined, { onSettled: () => void navigate('/sign-in', { replace: true }) })
      }
    >
      <Icon.SignOut size={13} aria-hidden="true" />
      {signOut.isPending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
