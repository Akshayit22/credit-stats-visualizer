import { requireSessionUser } from '@/server/auth/session';
import { redirectToSection } from '@/server/db/first-account';
import { NoAccountScreen } from '@/client/screens/no-account-screen';

export const dynamic = 'force-dynamic';

export default async function SavingsIndexPage() {
  const user = await requireSessionUser();
  const empty = await redirectToSection(user.userId, 'savings');

  return (
    <NoAccountScreen
      kicker="Savings"
      title="No savings statements yet"
      body="Upload a savings account statement PDF and this fills in: the balance day by day, money in against money out, and the interest the bank credited you."
      otherHref={empty.otherHref}
      otherLabel="Open the credit card instead"
    />
  );
}
