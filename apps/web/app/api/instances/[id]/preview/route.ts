import { NextResponse } from 'next/server';
import { requireChatInstance } from '@/lib/app-chat';
import { getSandboxPreviewHost } from '@/lib/gateway-client';

export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

function fallbackHost(sandboxId: string | undefined, port: number): string | null {
  const id = (sandboxId || '').trim();
  if (!id) return null;
  const domain = (process.env.XIBECODE_E2B_PREVIEW_DOMAIN || 'e2b.app').replace(/^\.+/, '');
  return `https://${port}-${id}.${domain}`;
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  const port = Number(new URL(req.url).searchParams.get('port') || '3000');
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: 'Invalid port' }, { status: 400 });
  }

  const fromGateway = await getSandboxPreviewHost(gate.inst.sessionId, Math.floor(port));
  const host = fromGateway || fallbackHost(gate.inst.sandboxId, Math.floor(port));
  if (!host) {
    return NextResponse.json({ error: 'No preview host' }, { status: 404 });
  }
  return NextResponse.json({
    host,
    port: Math.floor(port),
    sandboxId: gate.inst.sandboxId || null,
  });
}
