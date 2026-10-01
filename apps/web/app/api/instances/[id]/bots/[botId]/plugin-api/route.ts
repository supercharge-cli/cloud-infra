import { NextResponse } from 'next/server';
import { requireChatInstance } from '@/lib/app-chat';
import { botsEnabled, syncBots, validBot } from '@/lib/bot-service';
import { proxyInbox } from '@/lib/app-chat';

type Ctx = { params: Promise<{ id: string; botId: string }> };

const MANAGED_MCP_ACTIONS = new Set([
  'status',
  'validate',
  'install',
  'pluginAction',
  'apply',
  'retry',
  'verify',
  'remove',
]);

/**
 * Owner-checked Managed MCP proxy.
 *
 * The signed-in Vectra user must own the instance, the instance must run the
 * Supercharge E2B runtime, and the bot must exist. The request body is a
 * bounded JSON action; the sandbox daemon resolves target identity, the
 * isolated Plugin API service, and the per-conversation bridge on its own.
 * No daemon URL, filesystem path, credential, or UID is accepted here.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id, botId } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) {
    return NextResponse.json({ error: 'Supercharge E2B only' }, { status: 404 });
  }
  const bot = await validBot(gate.inst, botId);
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const action = (body as { action?: unknown }).action;
  if (typeof action !== 'string' || !MANAGED_MCP_ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Unsupported managed MCP action' }, { status: 400 });
  }

  try {
    await syncBots(gate.inst);
    const proxied = await proxyInbox(
      gate.inst,
      `/v1/app/bots/${encodeURIComponent(botId)}/plugin-api`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const text = await proxied.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
    return NextResponse.json(data, { status: proxied.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
