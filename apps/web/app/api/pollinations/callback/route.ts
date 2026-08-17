import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  applyPollinationsToAllWorkspaces,
  saveAccountPollinations,
} from '@/lib/pollinations-account';
import {
  exchangeCode,
  OAUTH_COOKIE,
  oauthCookieOptions,
  connectedPageUrl,
  verifyOauthState,
} from '@/lib/pollinations-byop';

export const dynamic = 'force-dynamic';

function fail(fromApp: boolean, error: string, instanceId?: string) {
  const res = NextResponse.redirect(connectedPageUrl({ instanceId, fromApp, error }));
  res.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').trim();
  const state = (url.searchParams.get('state') || '').trim();
  const denied = url.searchParams.get('error');

  const store = await cookies();
  const raw = store.get(OAUTH_COOKIE)?.value || '';
  const oauth = verifyOauthState(raw);

  if (!oauth) {
    const res = NextResponse.redirect(
      new URL('/pollinations/connected?error=session_expired', url.origin),
    );
    res.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
    return res;
  }

  if (denied) {
    return fail(oauth.fromApp, 'Authorization cancelled', oauth.instanceId);
  }
  if (!code || state !== oauth.nonce) {
    return fail(oauth.fromApp, 'Invalid OAuth callback', oauth.instanceId);
  }

  try {
    const token = await exchangeCode({ code, verifier: oauth.verifier });
    await saveAccountPollinations({
      userId: oauth.userId,
      accessToken: token.accessToken,
      expiresIn: token.expiresIn,
    });
    await applyPollinationsToAllWorkspaces(oauth.userId, token.accessToken);

    const ok = NextResponse.redirect(
      connectedPageUrl({ instanceId: oauth.instanceId, fromApp: oauth.fromApp }),
    );
    ok.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
    return ok;
  } catch (e) {
    return fail(oauth.fromApp, (e as Error).message, oauth.instanceId);
  }
}
