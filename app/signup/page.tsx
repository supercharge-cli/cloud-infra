import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { SiteHeader } from '@/components/site-header';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';

export const metadata = {
  title: `Sign up · ${BRAND.name}`,
};

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect(BRAND.dashboard);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <SiteHeader />
      <AuthForm mode="signup" />
    </div>
  );
}
