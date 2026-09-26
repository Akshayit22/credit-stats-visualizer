import { resolveSection, type AccountType, type SectionView } from '@cred-stats/shared';
import { Navigate } from 'react-router';
import { PageError, PageLoading } from '../components/page-state';
import { useWorkspace } from '../hooks/queries';
import { NoAccountScreen } from '../screens/no-account-screen';

interface SectionCopy {
  kicker: string;
  title: string;
  body: string;
  otherLabel: string;
}

const COPY: Record<'card' | 'cashback' | 'savings', SectionCopy> = {
  card: {
    kicker: 'Credit card',
    title: 'No card statements yet',
    body: 'Upload a credit card statement PDF and this fills in: the bill through the cycle, where it went, cashback earned against cashback credited, and every fee.',
    otherLabel: 'Open savings instead',
  },
  cashback: {
    kicker: 'Cashback',
    title: 'No card statements yet',
    body: 'Cashback is tracked per card. Upload a credit card statement and this shows what each purchase earned, what was credited, and which purchases earned nothing at all.',
    otherLabel: 'Open savings instead',
  },
  savings: {
    kicker: 'Savings',
    title: 'No savings statements yet',
    body: 'Upload a savings account statement PDF and this fills in: the balance day by day, money in against money out, and the interest the bank credited you.',
    otherLabel: 'Open the credit card instead',
  },
};

/**
 * `/accounts`, `/cashback` and `/savings` name a section, not an account. They
 * send you to the newest statement of your first account of that kind, or say
 * plainly that you have not uploaded one yet.
 */
export function SectionPage({ section }: { section: 'card' | 'cashback' | 'savings' }) {
  const workspace = useWorkspace();

  if (workspace.isPending) return <PageLoading />;
  if (workspace.isError) return <PageError error={workspace.error} />;

  const type: AccountType = section === 'savings' ? 'savings' : 'credit_card';
  const view: SectionView = section === 'cashback' ? 'cashback' : 'account';
  const target = resolveSection(workspace.data, type, view);

  if (target.kind === 'redirect') return <Navigate to={target.href} replace />;

  const copy = COPY[section];
  return <NoAccountScreen {...copy} otherHref={target.otherHref} />;
}
