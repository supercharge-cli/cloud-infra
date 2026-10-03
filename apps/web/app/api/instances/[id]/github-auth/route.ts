import { NextResponse } from 'next/server';
import { requireChatInstance } from '@/lib/app-chat';
import { cancelDeviceAuth, DeviceAuthError, finishDeviceAuth, startDeviceAuth, statusDeviceAuth } from '@/lib/github-device-auth';

export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

async function handle(req: Request, ctx: Ctx, method: 'GET' | 'POST' | 'DELETE') {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (gate.inst.runtime !== 'supercharge' || !gate.inst.sandboxId) return NextResponse.json({ error: 'Supercharge VM required' }, { status: 404 });
  try {
    if (method === 'GET') return NextResponse.json(await statusDeviceAuth(gate.inst));
    if (method === 'DELETE') return NextResponse.json(await cancelDeviceAuth(gate.inst));
    const body = await req.json().catch(() => null) as { action?: string; conversationId?: string; requestId?: string } | null;
    if (body?.action === 'start' && typeof body.conversationId === 'string' && typeof body.requestId === 'string') {
      return NextResponse.json(await startDeviceAuth(gate.inst, body.conversationId, body.requestId));
    }
    if (body?.action === 'done') return NextResponse.json(await finishDeviceAuth(gate.inst));
    return NextResponse.json({ error: 'Invalid GitHub login action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DeviceAuthError ? error.message : 'GitHub login is temporarily unavailable' }, { status: error instanceof DeviceAuthError ? error.statusCode : 502 });
  }
}

export const GET = (req: Request, ctx: Ctx) => handle(req, ctx, 'GET');
export const POST = (req: Request, ctx: Ctx) => handle(req, ctx, 'POST');
export const DELETE = (req: Request, ctx: Ctx) => handle(req, ctx, 'DELETE');
