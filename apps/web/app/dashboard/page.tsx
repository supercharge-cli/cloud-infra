import { Dashboard } from '@/components/dashboard';
import { AuthForm } from '@/components/auth-form';
import { SiteHeader } from '@/components/site-header';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { safeReturnTo } from '@/lib/pollinations-byop';

export const metadata = {
  title: `Dashboard · ${BRAND.name}`,
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const returnTo = safeReturnTo((await searchParams).returnTo) || BRAND.dashboard;
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="min-h-screen bg-black text-zinc-100">
        <SiteHeader />
        <AuthForm mode="login" returnTo={returnTo} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <SiteHeader />
      <Dashboard email={user.email} />
    </div>
  );
}
