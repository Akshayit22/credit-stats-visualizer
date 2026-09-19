import { requireSessionUser } from '@/server/auth/session';
import { redirectToSection } from '@/server/db/first-account';
import { NoAccountScreen } from '@/client/screens/no-account-screen';

export const dynamic = 'force-dynamic';

/**
 * Cashback belongs to a card, so this sends you to that card's cashback screen.
 * A savings account earns interest rather than cashback, which the savings
 * screen already shows.
 */
export default async function CashbackIndexPage() {
  const user = await requireSessionUser();
  const empty = await redirectToSection(user.userId, 'credit_card', 'cashback');

  return (
    <NoAccountScreen
      kicker="Cashback"
      title="No card statements yet"
      body="Cashback is tracked per card. Upload a credit card statement and this shows what each purchase earned, what was credited, and which purchases earned nothing at all."
      otherHref={empty.otherHref}
      otherLabel="Open savings instead"
    />
  );
}
