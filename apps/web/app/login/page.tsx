import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { SiteHeader } from '@/components/site-header';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { safeReturnTo } from '@/lib/pollinations-byop';

export const metadata = {
  title: `Log in · ${BRAND.name}`,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const q = await searchParams;
  const returnTo = safeReturnTo(q.returnTo);
  const user = await getSessionUser();
  if (user) redirect(returnTo || BRAND.dashboard);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <SiteHeader />
      <AuthForm mode="login" returnTo={returnTo} />
    </div>
  );
}
