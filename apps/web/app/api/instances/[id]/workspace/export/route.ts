import { NextResponse } from 'next/server';
import { gatewaySessionFetch } from '@/lib/gateway-client';
import { requireChatInstance } from '@/lib/app-chat';

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  try {
    const res = await gatewaySessionFetch(
      gate.inst.sessionId,
      '/export',
      { headers: { accept: 'application/gzip' } },
      { sandboxId: gate.inst.sandboxId },
    );
    const headers = new Headers();
    headers.set('content-type', res.headers.get('content-type') || 'application/gzip');
    headers.set(
      'content-disposition',
      res.headers.get('content-disposition') || `attachment; filename="vectra-workspace-${gate.inst.id}.tar.gz"`,
    );
    const length = res.headers.get('content-length');
    if (length) headers.set('content-length', length);
    return new Response(res.body, { status: res.status, headers });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
