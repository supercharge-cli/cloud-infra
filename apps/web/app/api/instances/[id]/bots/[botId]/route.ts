import { NextResponse } from 'next/server';
import { BotInputError, exposedBot, getBot, updateBot, type BotInput } from '@/lib/bots';
import { botsEnabled, syncBots } from '@/lib/bot-service';
import { requireChatInstance } from '@/lib/app-chat';

type Ctx = { params: Promise<{ id: string; botId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id, botId } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) return NextResponse.json({ error: 'Supercharge E2B only' }, { status: 404 });
  const bot = await getBot(gate.inst, botId);
  return bot ? NextResponse.json({ bot: exposedBot(bot) }) : NextResponse.json({ error: 'Bot not found' }, { status: 404 });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id, botId } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) return NextResponse.json({ error: 'Supercharge E2B only' }, { status: 404 });
  try {
    const patch = await req.json() as Partial<BotInput> & { archived?: boolean };
    const bot = await updateBot(gate.inst, botId, patch);
    if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    await syncBots(gate.inst);
    return NextResponse.json({ bot: exposedBot(bot) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, {
      status: error instanceof BotInputError || error instanceof SyntaxError ? 400 : 502,
    });
  }
}
