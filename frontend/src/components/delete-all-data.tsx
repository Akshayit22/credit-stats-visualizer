import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useDeleteProfile } from '../hooks/queries';
import { ApiError } from '../services/api-client';
import { Icon } from './icon';

/**
 * "Delete all my data", with a second click to confirm. It removes every
 * account, statement, transaction, summary and category rule, and the profile
 * itself — so it also ends the session, and the next stop is sign-in.
 */
export function DeleteAllData() {
  const remove = useDeleteProfile();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const deleteEverything = () =>
    remove.mutate(undefined, {
      onSuccess: () => void navigate('/sign-in', { replace: true }),
    });

  const error =
    remove.error instanceof ApiError
      ? remove.error.message
      : remove.error
        ? 'Your data could not be deleted.'
        : null;

  return (
    <>
      {confirming ? (
        <>
          <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
            Keep it
          </button>
          <button
            type="button"
            className="btn btn-secondary is-danger"
            disabled={remove.isPending}
            onClick={deleteEverything}
          >
            {remove.isPending ? 'Deleting…' : 'Yes, delete everything'}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
          Delete all my data
        </button>
      )}

      {confirming && (
        <p className="banner is-full-width" data-tone="negative" role="alert">
          <Icon.Warning size={16} aria-hidden="true" />
          <span className="banner-body">
            This removes every account, statement, transaction and category rule, and your profile,
            and signs you out. It cannot be undone.
          </span>
        </p>
      )}
      {error && (
        <div className="banner is-full-width" data-tone="negative" role="alert">
          <span className="banner-body">{error}</span>
        </div>
      )}
    </>
  );
}
