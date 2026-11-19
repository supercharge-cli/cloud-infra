import { NextResponse } from 'next/server';
import { proxyInbox } from './app-chat';
import { botsEnabled, syncBots, validBot } from './bot-service';
import type { Instance } from './store';

const chatIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

export async function activeBotChat(instance: Instance, botId: string): Promise<string> {
  const listed = await proxyInbox(instance, `/v1/conversations?botId=${encodeURIComponent(botId)}`);
  const data = listed.ok ? await listed.json() as { active?: unknown; conversations?: { sessionId?: unknown; source?: unknown }[] } : { conversations: [] };
  const rows = (data.conversations ?? []).filter((row) => row.source !== 'group' && typeof row.sessionId === 'string' && chatIdPattern.test(row.sessionId));
  const active = typeof data.active === 'string' ? rows.find((row) => row.sessionId === data.active) : undefined;
  const chosen = (active ?? rows[0])?.sessionId;
  if (typeof chosen === 'string') return chosen;
  const created = await proxyInbox(instance, '/v1/conversations/new', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botId }),
  });
  const body = await created.json() as { active?: unknown; error?: unknown };
  if (!created.ok || typeof body.active !== 'string' || !chatIdPattern.test(body.active)) {
    throw new Error(typeof body.error === 'string' ? body.error : 'No conversation is available for this agent.');
  }
  return body.active;
}

export async function prepareBotRequest(
  instance: Instance,
  botId: unknown,
  chatId: unknown,
  options: { sync?: boolean; allowLegacyChatId?: boolean } = {},
): Promise<NextResponse | null> {
  if (botId === undefined && chatId === undefined) return null;
  if (!botsEnabled(instance)) {
    if (options.allowLegacyChatId && botId === undefined) return null;
    return NextResponse.json({ error: 'Bots are supported only for Supercharge E2B' }, { status: 404 });
  }
  if (botId !== undefined && (typeof botId !== 'string' || !await validBot(instance, botId))) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  }
  if (chatId !== undefined && (typeof chatId !== 'string' || !chatIdPattern.test(chatId))) {
    return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
  }
  if (botId !== undefined && chatId === undefined) {
    return NextResponse.json({ error: 'Conversation ID is required for bot-scoped messages' }, { status: 400 });
  }
  if (chatId !== undefined && botId === undefined && !options.allowLegacyChatId) {
    return NextResponse.json({ error: 'Bot ID is required for explicit conversations' }, { status: 400 });
  }
  if (options.sync && botId !== undefined) await syncBots(instance);
  return null;
}
