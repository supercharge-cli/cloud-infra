import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import {
  authorizeUrl,
  byopConfigured,
  OAUTH_COOKIE,
  oauthCookieOptions,
  pkceChallenge,
  pkceVerifier,
  pollinationsRedirectUri,
  signOauthState,
  verifyTicket,
} from '@/lib/pollinations-byop';
import { getInstance } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticket = url.searchParams.get('ticket');
  const instanceQ = (url.searchParams.get('instance') || '').trim();
  const fromApp = url.searchParams.get('from') === 'app';

  if (!byopConfigured()) {
    return NextResponse.redirect(
      new URL(
        `/pollinations/connected?error=${encodeURIComponent('Pollinations BYOP is not configured on the server.')}`,
        url.origin,
      ),
    );
  }

  let userId = '';
  let instanceId = instanceQ;
  let app = fromApp;

  const claimed = verifyTicket(ticket);
  if (claimed) {
    userId = claimed.userId;
    instanceId = claimed.instanceId;
    app = claimed.fromApp;
  } else {
    const user = await getSessionUser();
    if (!user) {
      const returnTo = `/pollinations/connect?${new URLSearchParams({
        ...(instanceQ ? { instance: instanceQ } : {}),
        ...(fromApp ? { from: 'app' } : {}),
      }).toString()}`;
      return NextResponse.redirect(
        new URL(`${BRAND.login}?returnTo=${encodeURIComponent(returnTo)}`, url.origin),
      );
    }
    userId = user.id;
  }

  if (!instanceId) {
    return NextResponse.redirect(new URL(`${BRAND.dashboard}?error=missing_instance`, url.origin));
  }

  const inst = await getInstance(userId, instanceId);
  if (!inst || inst.status === 'destroyed') {
    return NextResponse.redirect(new URL(`${BRAND.dashboard}?error=instance_not_found`, url.origin));
  }

  const verifier = pkceVerifier();
  const nonce = pkceVerifier();
  const signed = signOauthState({
    userId,
    instanceId,
    fromApp: app,
    verifier,
    nonce,
  });

  const res = NextResponse.redirect(authorizeUrl({ challenge: pkceChallenge(verifier), nonce }));
  res.cookies.set(OAUTH_COOKIE, signed, oauthCookieOptions());
  return res;
}

export async function POST() {
  return NextResponse.json({
    configured: byopConfigured(),
    redirectUri: pollinationsRedirectUri(),
  });
}
