import { appInboxFetch } from '@/lib/gateway-client';
import { getInstanceById } from '@/lib/store';

export const maxDuration = 60;

type Ctx = { params: Promise<{ instanceId: string; token: string }> };

/**
 * Unguessable public image URL for model vision.
 * Token is created by the sandbox inbox; no user session required.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { instanceId, token } = await ctx.params;
  const safeToken = token.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!instanceId || !safeToken) {
    return new Response('not found', { status: 404 });
  }
  const inst = await getInstanceById(instanceId);
  if (!inst || inst.status === 'destroyed' || !inst.sessionId) {
    return new Response('not found', { status: 404 });
  }
  try {
    const res = await appInboxFetch(
      inst.sessionId,
      `/v1/public/${encodeURIComponent(safeToken)}`,
      { headers: { accept: '*/*' } },
      { sandboxId: inst.sandboxId },
    );
    if (!res.ok || !res.body) {
      return new Response('not found', { status: res.status === 404 ? 404 : 502 });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        'content-type': res.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'public, max-age=3600',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return new Response('unavailable', { status: 502 });
  }
}
