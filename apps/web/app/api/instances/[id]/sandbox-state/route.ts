import { NextResponse } from 'next/server';
import { requireChatInstance } from '@/lib/app-chat';
import { attachSandboxHost } from '@/lib/gateway-client';

export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

async function host(sessionId: string, path: string, method: string, body?: string) {
  const attach = await attachSandboxHost(sessionId);
  const url = new URL(path, attach.url.endsWith('/') ? attach.url : `${attach.url}/`);
  return fetch(url, {
    method,
    headers: { authorization: `Bearer ${attach.token}`, 'content-type': 'application/json' },
    body,
  });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || 'xibecode') !== 'supercharge') {
    return NextResponse.json({ error: 'Supercharge session not found' }, { status: 404 });
  }
  try {
    const [agents, settings] = await Promise.all([
      host(gate.inst.sessionId, '/v1/agents', 'GET'),
      host(gate.inst.sessionId, '/v1/settings', 'GET'),
    ]);
    const agentBody = await agents.json().catch(() => ({ error: 'agents unavailable' }));
    const settingsBody = await settings.json().catch(() => ({ error: 'settings unavailable' }));
    if (!agents.ok || !settings.ok) {
      return NextResponse.json({ error: agentBody.error || settingsBody.error || 'Sandbox state unavailable' }, { status: 502 });
    }
    return NextResponse.json({ agents: agentBody.agents, settings: settingsBody });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || 'xibecode') !== 'supercharge') {
    return NextResponse.json({ error: 'Supercharge session not found' }, { status: 404 });
  }
  const body = await req.json().catch(() => null) as { agent?: unknown; settings?: unknown } | null;
  if (!body?.agent && !body?.settings) {
    return NextResponse.json({ error: 'agent or settings required' }, { status: 400 });
  }
  try {
    if (body.agent) {
      const saved = await host(gate.inst.sessionId, '/v1/agents', 'PUT', JSON.stringify(body.agent));
      const payload = await saved.json().catch(() => ({ error: 'agent save failed' }));
      if (!saved.ok) return NextResponse.json(payload, { status: saved.status });
    }
    if (body.settings) {
      const saved = await host(gate.inst.sessionId, '/v1/settings', 'PUT', JSON.stringify(body.settings));
      const payload = await saved.json().catch(() => ({ error: 'settings save failed' }));
      if (!saved.ok) return NextResponse.json(payload, { status: saved.status });
      return NextResponse.json(payload);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
