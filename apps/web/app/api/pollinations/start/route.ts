import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import {
  applyPollinationsToAllWorkspaces,
  fetchPollenCatalog,
  fetchPollenProfile,
  publicPollinations,
} from '@/lib/pollinations-account';
import {
  byopConfigured,
  connectPageUrl,
  pollinationsRedirectUri,
  signTicket,
} from '@/lib/pollinations-byop';
import { findUserById, listInstancesForUser, setUserPollinations } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  if (!byopConfigured()) {
    return NextResponse.json(
      {
        error: 'Pollinations BYOP is not configured',
        hint: 'Set POLLINATIONS_APP_KEY (pk_…) on the server.',
        redirectUri: pollinationsRedirectUri(),
      },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    instanceId?: string;
    fromApp?: boolean;
  };
  const fromApp = body.fromApp !== false;
  const instanceId = String(body.instanceId || '').trim() || undefined;
  const ticket = signTicket({ userId: user.id, instanceId, fromApp });
  return NextResponse.json({
    ok: true,
    url: connectPageUrl({ ticket, instanceId, fromApp }),
    redirectUri: pollinationsRedirectUri(),
  });
}

export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({
      configured: byopConfigured(),
      connected: false,
      redirectUri: pollinationsRedirectUri(),
    });
  }
  const user = await findUserById(session.id);
  const pub = publicPollinations(user);
  const instances = (await listInstancesForUser(session.id)).filter((i) => i.status !== 'destroyed');
  const applied = instances.filter((i) => i.config?.provider === 'pollinations' && i.config?.hasApiKey).length;
  const models = await fetchPollenCatalog().catch(() => []);
  let usage: Record<string, unknown> = {};
  let balance;
  let recent;
  let daily;
  let scopeHint;
  if (user?.pollinations?.accessToken) {
    try {
      const profile = await fetchPollenProfile(user.pollinations.accessToken);
      usage = profile.usage;
      balance = profile.balance;
      recent = profile.recent;
      daily = profile.daily;
      scopeHint = profile.scopeHint;
    } catch {
      /* ignore */
    }
  }
  return NextResponse.json({
    configured: byopConfigured(),
    redirectUri: pollinationsRedirectUri(),
    ...pub,
    workspaces: { total: instances.length, applied },
    usage,
    balance,
    recent,
    daily,
    models,
    scopeHint,
  });
}

export async function DELETE() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  await setUserPollinations(session.id, null);
  return NextResponse.json({ ok: true, connected: false });
}

export async function PUT() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const user = await findUserById(session.id);
  const token = user?.pollinations?.accessToken;
  if (!token) {
    return NextResponse.json({ error: 'Not connected' }, { status: 400 });
  }
  const result = await applyPollinationsToAllWorkspaces(session.id, token);
  return NextResponse.json({ ok: true, ...result });
}
