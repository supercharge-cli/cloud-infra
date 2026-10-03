import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { SiteHeader } from '@/components/site-header';
import { Marketplace } from '@/components/marketplace/marketplace';

export const metadata = { title: `Plugin Marketplace · ${BRAND.name}` };

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ instance?: string; bot?: string }> }) {
  if (!await getSessionUser()) redirect(BRAND.login);
  const { instance, bot } = await searchParams;
  return <><SiteHeader /><Marketplace initialInstance={instance} initialBot={bot} /></>;
}
