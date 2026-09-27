import { NextResponse } from 'next/server';
import { botsEnabled, syncBots, validBot } from './bot-service';
import type { Instance } from './store';

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
  if (chatId !== undefined && (typeof chatId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(chatId))) {
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
