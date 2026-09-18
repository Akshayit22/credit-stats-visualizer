import { redirect } from 'next/navigation';
import { auth } from './config';

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string;
}

/** The signed-in user, or null. Never throws. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return {
    userId: id,
    email: session?.user?.email ?? '',
    name: session?.user?.name ?? '',
    avatarUrl: session?.user?.image ?? '',
  };
}

/** For pages: bounce to sign-in when there is no session. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');
  return user;
}
