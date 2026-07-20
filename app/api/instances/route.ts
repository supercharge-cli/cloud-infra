import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createGatewaySession } from '@/lib/gateway-client';
import { createInstanceRecord, listInstances } from '@/lib/store';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const instances = await listInstances(user.id);
  return NextResponse.json({ instances });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name || 'workspace').slice(0, 64);
    const session = await createGatewaySession({ strategy: 'sandbox_full' });
    const instance = await createInstanceRecord({
      userId: user.id,
      name,
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
    });
    return NextResponse.json({ instance }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to provision sandbox: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
