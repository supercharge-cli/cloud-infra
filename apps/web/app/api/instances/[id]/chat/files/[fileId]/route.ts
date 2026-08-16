import { requireChatInstance } from '@/lib/app-chat';
import { appInboxFetch } from '@/lib/gateway-client';

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; fileId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id, fileId } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const safeId = encodeURIComponent(fileId.replace(/[^a-zA-Z0-9._-]/g, ''));
  try {
    const res = await appInboxFetch(
      gate.inst.sessionId,
      `/v1/files/${safeId}`,
      {},
      { sandboxId: gate.inst.sandboxId },
    );
    if (!res.body) {
      return new Response('empty', { status: 502 });
    }
    return new Response(res.body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') || 'application/octet-stream',
        'content-disposition':
          res.headers.get('content-disposition') || `attachment; filename="${safeId}"`,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
