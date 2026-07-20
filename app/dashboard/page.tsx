import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/dashboard';
import { SiteHeader } from '@/components/site-header';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';

export const metadata = {
  title: `Dashboard · ${BRAND.name}`,
};

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect(BRAND.login);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <SiteHeader />
      <Dashboard email={user.email} />
    </div>
  );
}
