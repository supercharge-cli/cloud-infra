import { redirect } from 'next/navigation';
import { AdminPanel } from '@/components/admin-panel';
import { SiteHeader } from '@/components/site-header';
import { getSessionUserWithRole } from '@/lib/auth';
import { BRAND } from '@/lib/brand';

export const metadata = {
  title: `Admin · ${BRAND.name}`,
};

export default async function AdminPage() {
  const user = await getSessionUserWithRole();
  if (!user) redirect(BRAND.login);
  if (user.role !== 'admin') redirect(BRAND.dashboard);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <SiteHeader />
      <AdminPanel email={user.email} />
    </div>
  );
}
