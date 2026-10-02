import { NextResponse } from 'next/server';
import { requireChatInstance } from '@/lib/app-chat';
import { botsEnabled, syncBots, validBot } from '@/lib/bot-service';
import { proxyInbox } from '@/lib/app-chat';
import { resolveCatalogEntry } from '@/lib/managed-mcp/catalog';

type Ctx = { params: Promise<{ id: string; botId: string }> };

const MANAGED_MCP_ACTIONS = new Set([
  'status',
  'validate',
  'install',
  'installCatalog',
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
  const gatewayToken = process.env.XIBECODE_GATEWAY_TOKEN?.trim() || process.env.XIBECODE_SANDBOX_AUTH_TOKEN?.trim();
  const inboxSecret = process.env.XIBECODE_APP_INBOX_SECRET?.trim() || process.env.XIBECODE_GATEWAY_TOKEN?.trim();
  if (!gatewayToken || !inboxSecret) {
    return NextResponse.json({ error: 'Managed MCP requires authenticated gateway and sandbox control' }, { status: 503 });
  }
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) {
    return NextResponse.json({ error: 'Supercharge E2B only' }, { status: 404 });
  }
  const bot = await validBot(gate.inst, botId);
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (declaredLength > 512 * 1024) {
    return NextResponse.json({ error: 'Managed MCP request exceeds 512 KiB' }, { status: 413 });
  }
  let body: unknown;
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, 'utf8') > 512 * 1024) {
      return NextResponse.json({ error: 'Managed MCP request exceeds 512 KiB' }, { status: 413 });
    }
    body = JSON.parse(text);
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
  const payload = body as Record<string, unknown>;
  if (action === 'installCatalog' || (action === 'pluginAction' && (payload.pluginAction as { action?: unknown } | null)?.action === 'update')) {
    const catalogId = payload.catalogId;
    const catalogSha256 = payload.catalogSha256;
    if (typeof catalogId !== 'string' || typeof catalogSha256 !== 'string' ||
        !resolveCatalogEntry(catalogId, catalogSha256) ||
        (action === 'pluginAction' && payload.pluginId !== catalogId)) {
      return NextResponse.json({ error: 'Catalog release is unavailable' }, { status: 400 });
    }
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
