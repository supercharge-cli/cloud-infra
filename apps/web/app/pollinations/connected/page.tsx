import { BRAND } from '@/lib/brand';
import { appDeepLink } from '@/lib/pollinations-byop';
import { ConnectedClient } from './connected-client';

export const metadata = {
  title: `Pollen connected · ${BRAND.name}`,
};

export default async function PollinationsConnectedPage({
  searchParams,
}: {
  searchParams: Promise<{ instance?: string; from?: string; error?: string }>;
}) {
  const q = await searchParams;
  const instanceId = (q.instance || '').trim();
  const fromApp = q.from === 'app';
  const error = (q.error || '').trim();
  return (
    <ConnectedClient
      instanceId={instanceId}
      fromApp={fromApp}
      error={error}
      deepLink={instanceId ? appDeepLink(instanceId) : ''}
      dashboardHref={instanceId ? `${BRAND.dashboard}?selected=${encodeURIComponent(instanceId)}` : BRAND.dashboard}
    />
  );
}
