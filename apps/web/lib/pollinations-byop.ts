import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { publicBaseUrl } from '@/lib/telegram-webhook';

export const OAUTH_COOKIE = 'vectra_pollinations_oauth';
export const OAUTH_TTL_SEC = 10 * 60;
export const APP_SCHEME = 'vectra://pollinations/connected';
const AUTHORIZE = 'https://enter.pollinations.ai/authorize';
const TOKEN_URL = 'https://enter.pollinations.ai/api/oauth/token';

export type ByopTicket = {
  userId: string;
  instanceId?: string;
  fromApp: boolean;
  exp: number;
};

export type ByopOauthState = ByopTicket & {
  verifier: string;
  nonce: string;
};

function secret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production');
  }
  return 'dev-only-vectra-cloud-auth-secret';
}

function sign(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

function encodeSigned(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeSigned<T>(raw: string): T | null {
  try {
    const [body, sig] = raw.split('.');
    if (!body || !sig) return null;
    const expected = sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & {
      exp?: number;
    };
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function pollinationsAppKey(): string {
  return (process.env.POLLINATIONS_APP_KEY || process.env.POLLINATIONS_CLIENT_ID || '').trim();
}

export function byopConfigured(): boolean {
  return pollinationsAppKey().startsWith('pk_');
}

export function siteBaseUrl(): string {
  return publicBaseUrl() || 'https://infra.xibeai.in';
}

/** Must match the Redirect URI on the Pollinations App Key exactly. */
export function pollinationsRedirectUri(): string {
  return `${siteBaseUrl()}/api/pollinations/callback`;
}

export function pkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function signTicket(input: Omit<ByopTicket, 'exp'>): string {
  return encodeSigned({
    ...input,
    exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SEC,
  });
}

export function verifyTicket(raw: string | null | undefined): ByopTicket | null {
  if (!raw) return null;
  const p = decodeSigned<ByopTicket>(raw);
  if (!p?.userId) return null;
  return p;
}

export function signOauthState(input: Omit<ByopOauthState, 'exp'>): string {
  return encodeSigned({
    ...input,
    exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SEC,
  });
}

export function verifyOauthState(raw: string | null | undefined): ByopOauthState | null {
  if (!raw) return null;
  const p = decodeSigned<ByopOauthState>(raw);
  if (!p?.userId || !p.verifier || !p.nonce) return null;
  return p;
}

export function authorizeUrl(input: { challenge: string; nonce: string }): string {
  const key = pollinationsAppKey();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: key,
    redirect_uri: pollinationsRedirectUri(),
    scope: 'profile usage account:usage',
    state: input.nonce,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    expiry: '150',
    budget: '10',
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCode(input: {
  code: string;
  verifier: string;
}): Promise<{ accessToken: string; expiresIn?: number; scope?: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: pollinationsAppKey(),
    redirect_uri: pollinationsRedirectUri(),
    code_verifier: input.verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Token exchange failed (${res.status})`);
  }
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

export function connectPageUrl(opts: { ticket?: string; instanceId?: string; fromApp?: boolean }): string {
  const q = new URLSearchParams();
  if (opts.ticket) q.set('ticket', opts.ticket);
  if (opts.instanceId) q.set('instance', opts.instanceId);
  if (opts.fromApp) q.set('from', 'app');
  return `${siteBaseUrl()}/pollinations/connect?${q.toString()}`;
}

export function connectedPageUrl(opts: {
  instanceId?: string;
  fromApp?: boolean;
  error?: string;
}): string {
  const q = new URLSearchParams();
  if (opts.instanceId) q.set('instance', opts.instanceId);
  if (opts.fromApp) q.set('from', 'app');
  if (opts.error) q.set('error', opts.error);
  const qs = q.toString();
  return `${siteBaseUrl()}/pollinations/connected${qs ? `?${qs}` : ''}`;
}

export function appDeepLink(instanceId?: string): string {
  if (instanceId) return `${APP_SCHEME}?instance=${encodeURIComponent(instanceId)}`;
  return APP_SCHEME;
}

/** Only same-site relative paths. Blocks open redirects. */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let path = raw.trim();
  try {
    if (/^https?:\/\//i.test(path)) {
      const u = new URL(path);
      const base = new URL(siteBaseUrl());
      if (u.host !== base.host) return null;
      path = `${u.pathname}${u.search}`;
    }
  } catch {
    return null;
  }
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.startsWith('/login') || path.startsWith('/signup')) return null;
  return path;
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: OAUTH_TTL_SEC,
    secure: process.env.NODE_ENV === 'production',
  };
}
