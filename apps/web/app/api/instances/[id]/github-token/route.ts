import { NextResponse } from 'next/server';
import { requireChatInstance, proxyInbox } from '@/lib/app-chat';
import { execInSession, gatewaySessionFetch } from '@/lib/gateway-client';
import { isDirectGitHubConversation, isGitHubCliToken, type ConversationListing } from '@/lib/github-token';
import { saveTokenMessage } from '@/lib/github-token-chat';

type Ctx = { params: Promise<{ id: string }> };

const privateHeaders = { 'cache-control': 'no-store, private', pragma: 'no-cache' };
const reply = (data: object, status = 200) => NextResponse.json(data, { status, headers: privateHeaders });

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (gate.inst.runtime !== 'supercharge') return reply({ error: 'GitHub authentication requires a Supercharge VM.' }, 400);
  if (!process.env.XIBECODE_GATEWAY_TOKEN?.trim()) return reply({ error: 'Authenticated VM access is unavailable.' }, 503);

  let body: { botId?: unknown; chatId?: unknown; source?: unknown; confirmation?: unknown; requestId?: unknown };
  try { body = await req.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
  if (body.botId !== 'github' || (body.source !== 'cli' && body.source !== 'mcp') || body.confirmation !== 'Send token to this chat' ||
      typeof body.chatId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.chatId) ||
      typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)) {
    return reply({ error: 'A confirmed direct GitHub conversation is required.' }, 400);
  }
  try {
    const response = await proxyInbox(gate.inst, '/v1/conversations?botId=github');
    if (!response.ok) return reply({ error: 'Could not verify the GitHub conversation.' }, 502);
    const listing = await response.json() as ConversationListing;
    if (!isDirectGitHubConversation(listing, body.chatId)) {
      return reply({ error: 'The selected conversation is not a direct GitHub conversation.' }, 403);
    }
    const detail = await proxyInbox(gate.inst, `/v1/conversations/${encodeURIComponent(body.chatId)}?botId=github`);
    if (!detail.ok) return reply({ error: 'GitHub conversation could not be verified.' }, 403);
    const conversation = await detail.json() as { botId?: string; sessionId?: string; messages?: unknown[] };
    if (conversation.botId !== 'github' || conversation.sessionId !== body.chatId || !Array.isArray(conversation.messages)) {
      return reply({ error: 'GitHub conversation could not be verified.' }, 403);
    }
    let token: string;
    if (body.source === 'cli') {
      const result = await execInSession(gate.inst.sessionId,
        'env -u GH_TOKEN -u GITHUB_TOKEN HOME=/home/user GH_CONFIG_DIR=/home/user/.config/gh gh auth token --hostname github.com',
        { sandboxId: gate.inst.sandboxId, runtime: 'supercharge', timeout: 20 });
      token = String(result.stdout || '').trim();
      if (!result.success || !isGitHubCliToken(token)) {
        return reply({ error: 'GitHub CLI is not authenticated in this VM, or its token is unavailable.' }, 409);
      }
    } else {
      const result = await gatewaySessionFetch(gate.inst.sessionId, '/github-mcp-token', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sandboxId: gate.inst.sandboxId, botId: 'github' }),
        signal: AbortSignal.timeout(25_000),
      }, { sandboxId: gate.inst.sandboxId, runtime: 'supercharge' });
      if (!result.ok) return reply({ error: 'GitHub MCP token is not configured for this bot in this VM.' }, 409);
      const data = await result.json() as { token?: unknown; sandboxId?: unknown };
      if (data.sandboxId !== gate.inst.sandboxId || typeof data.token !== 'string' || !isGitHubCliToken(data.token)) {
        return reply({ error: 'GitHub MCP token could not be confirmed for this VM.' }, 502);
      }
      token = data.token;
    }
    const savedToken = await saveTokenMessage({ _id: `${gate.inst.id}:${body.chatId}:${body.requestId}`,
      instanceId: gate.inst.id, userId: gate.inst.userId, sessionId: body.chatId, source: body.source,
      messageIndex: conversation.messages.length }, token);
    return reply({ saved: true, token: savedToken, source: body.source, botId: 'github', chatId: body.chatId });
  } catch {
    return reply({ error: 'GitHub token could not be retrieved from this VM.' }, 502);
  }
}
