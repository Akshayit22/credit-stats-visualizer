/**
 * The sidebar's open/closed flag lives in localStorage so it survives a reload.
 * It is read through `useSyncExternalStore` rather than an effect, which keeps
 * the server snapshot (open) and the client snapshot in step without a
 * cascading render on mount.
 */
const KEY = 'cred-stats:nav-open';

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== 'undefined') window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', listener);
  };
}

export function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function getServerSnapshot(): boolean {
  return true;
}

export function setOpen(next: boolean): void {
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    /* private windows and blocked storage: the toggle just does not persist */
  }
  for (const listener of listeners) listener();
}
