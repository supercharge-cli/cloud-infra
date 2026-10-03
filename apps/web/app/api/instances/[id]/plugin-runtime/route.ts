import { NextResponse } from 'next/server';
import { requireChatInstance } from '@/lib/app-chat';
import { botsEnabled, validBot } from '@/lib/bot-service';
import { pluginRuntimeStatus, upgradePluginRuntime } from '@/lib/plugin-runtime-upgrade';

type Ctx = { params: Promise<{ id: string }> };

async function target(ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return { response: gate.response };
  if (!botsEnabled(gate.inst) || !gate.inst.sandboxId || !gate.inst.sessionId) {
    return { response: NextResponse.json({ error: 'An existing Supercharge VM is required' }, { status: 404 }) };
  }
  if (!process.env.XIBECODE_GATEWAY_TOKEN?.trim() && !process.env.XIBECODE_SANDBOX_AUTH_TOKEN?.trim()) {
    return { response: NextResponse.json({ error: 'Authenticated gateway is required' }, { status: 503 }) };
  }
  return { instance: gate.inst };
}

export async function GET(_req: Request, ctx: Ctx) {
  const gate = await target(ctx);
  if (!gate.instance) return gate.response;
  try {
    return NextResponse.json(await pluginRuntimeStatus(gate.instance.sessionId, gate.instance.sandboxId!), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Plugin runtime status unavailable' }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await target(ctx);
  if (!gate.instance) return gate.response;
  if (Number(req.headers.get('content-length') || 0) > 256) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  }
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 256) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 2 || (body as { confirm?: unknown }).confirm !== true ||
      typeof (body as { botId?: unknown }).botId !== 'string') {
    return NextResponse.json({ error: 'Explicit confirmation and bot are required' }, { status: 400 });
  }
  const botId = (body as { botId: string }).botId;
  if (!await validBot(gate.instance, botId)) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  }
  try {
    const result = await upgradePluginRuntime(gate.instance.sessionId, gate.instance.sandboxId!, botId);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'VM update could not be confirmed. Refresh VM status; no VM was recreated.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
