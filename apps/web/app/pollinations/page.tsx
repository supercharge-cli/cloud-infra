import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { SiteHeader } from '@/components/site-header';
import { PollinationsHub } from './hub-client';

export const metadata = {
  title: `Pollinations · ${BRAND.name}`,
};

export default async function PollinationsPage() {
  const user = await getSessionUser();
  if (!user) redirect(`${BRAND.login}?returnTo=/pollinations`);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <SiteHeader />
      <PollinationsHub />
    </div>
  );
}
