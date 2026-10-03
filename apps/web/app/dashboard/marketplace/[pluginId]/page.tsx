import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { SiteHeader } from '@/components/site-header';
import { Marketplace } from '@/components/marketplace/marketplace';

export const metadata = { title: `Plugin details · ${BRAND.name}` };

export default async function PluginPage({ params, searchParams }: {
  params: Promise<{ pluginId: string }>;
  searchParams: Promise<{ instance?: string; bot?: string }>;
}) {
  if (!await getSessionUser()) redirect(BRAND.login);
  const [{ pluginId }, { instance, bot }] = await Promise.all([params, searchParams]);
  return <><SiteHeader /><Marketplace pluginId={pluginId} initialInstance={instance} initialBot={bot} /></>;
}
