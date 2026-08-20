import { NextResponse } from 'next/server';
import { createSandboxShare } from '@/lib/gateway-client';
import { requireChatInstance } from '@/lib/app-chat';

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const MAX_PATH_LENGTH = 512;
const MAX_NAME_LENGTH = 180;

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  let body: { path?: string; name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const path = String(body.path || '').trim();
  const name = String(body.name || '').trim();
  if (!path || path.length > MAX_PATH_LENGTH || path.includes('\0') || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid workspace path' }, { status: 400 });
  }
  if (name.length > MAX_NAME_LENGTH || name.includes('/') || name.includes('\\')) {
    return NextResponse.json({ error: 'Invalid share name' }, { status: 400 });
  }

  try {
    const share = await createSandboxShare(gate.inst.sessionId, path, {
      sandboxId: gate.inst.sandboxId,
      name: name || undefined,
    });
    return NextResponse.json({ ok: true, share });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message.slice(0, 500) },
      { status: 502 },
    );
  }
}
