import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import {
  byopConfigured,
  connectPageUrl,
  pollinationsRedirectUri,
  signTicket,
} from '@/lib/pollinations-byop';
import { getInstance } from '@/lib/store';

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
  const instanceId = String(body.instanceId || '').trim();
  if (!instanceId) {
    return NextResponse.json({ error: 'instanceId required' }, { status: 400 });
  }
  const inst = await getInstance(user.id, instanceId);
  if (!inst || inst.status === 'destroyed') {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  const fromApp = body.fromApp !== false;
  const ticket = signTicket({ userId: user.id, instanceId, fromApp });
  return NextResponse.json({
    ok: true,
    url: connectPageUrl({ ticket, instanceId, fromApp }),
    redirectUri: pollinationsRedirectUri(),
  });
}

export async function GET() {
  return NextResponse.json({
    configured: byopConfigured(),
    redirectUri: pollinationsRedirectUri(),
  });
}
