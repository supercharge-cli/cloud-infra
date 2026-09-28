import { NextResponse } from 'next/server';
import { BotInputError, createBot, exposedBot, listBots, type BotInput } from '@/lib/bots';
import { requireAgentCaller, syncBots } from '@/lib/bot-service';

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const caller = await requireAgentCaller(req, body);
  if (caller instanceof NextResponse) return caller;
  const { instance, botId } = caller;
  if (body.action === 'list') {
    return NextResponse.json({ bots: (await listBots(instance)).map((bot) => ({ id: bot.id, name: bot.name, defaultFolder: bot.defaultFolder, revision: bot.revision })) });
  }
  if (body.action !== 'create' || !body.input || botId !== 'main') {
    return NextResponse.json({ error: 'Only Main can create agents' }, { status: 403 });
  }
  try {
    const bot = await createBot(instance, body.input as BotInput, 'main');
    await syncBots(instance);
    return NextResponse.json({ bot: exposedBot(bot) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: error instanceof BotInputError ? 400 : 502 });
  }
}
