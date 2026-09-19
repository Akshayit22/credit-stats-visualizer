import { requireSessionUser } from '@/server/auth/session';
import { redirectToSection } from '@/server/db/first-account';
import { NoAccountScreen } from '@/client/screens/no-account-screen';

export const dynamic = 'force-dynamic';

/**
 * `/accounts` is what the sidebar links to. It sends you to your card, or says
 * plainly that you have not uploaded one — it used to 404.
 */
export default async function AccountsIndexPage() {
  const user = await requireSessionUser();
  const empty = await redirectToSection(user.userId, 'credit_card');

  return (
    <NoAccountScreen
      kicker="Credit card"
      title="No card statements yet"
      body="Upload a credit card statement PDF and this fills in: the bill through the cycle, where it went, cashback earned against cashback credited, and every fee."
      otherHref={empty.otherHref}
      otherLabel="Open savings instead"
    />
  );
}
