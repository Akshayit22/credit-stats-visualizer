/**
 * Who may see the admin overview.
 *
 * Hard-coded on purpose, as the owner asked: two addresses, no admin sign-up
 * and no separate login. An admin signs in with Google like anyone else, and
 * is recognised by the email Google verified. Adding someone means adding an
 * address here and deploying.
 */
export const ADMIN_EMAILS: readonly string[] = [
  'akshayit22@gmail.com',
  'akshaytelang395@gmail.com',
];

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
