import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { setupAiAndTelegram } from '@/lib/gateway-client';
import { getInstance, updateInstance } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  const body = (await req.json()) as {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    telegramBotToken?: string;
    discordBotToken?: string;
    slackBotToken?: string;
    slackAppToken?: string;
  };
  const apiKey = String(body.apiKey || '').trim();
  const telegramBotToken = String(body.telegramBotToken || '').trim();
  const discordBotToken = String(body.discordBotToken || '').trim();
  const slackBotToken = String(body.slackBotToken || '').trim();
  const slackAppToken = String(body.slackAppToken || '').trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
  }
  if (!telegramBotToken && !discordBotToken && !(slackBotToken && slackAppToken)) {
    return NextResponse.json(
      {
        error:
          'At least one channel required: telegramBotToken, discordBotToken, or slackBotToken+slackAppToken',
      },
      { status: 400 },
    );
  }

  try {
    const result = await setupAiAndTelegram(inst.sessionId, {
      provider: String(body.provider || 'openai'),
      apiKey,
      baseUrl: String(body.baseUrl || ''),
      model: String(body.model || ''),
      telegramBotToken: telegramBotToken || undefined,
      discordBotToken: discordBotToken || undefined,
      slackBotToken: slackBotToken || undefined,
      slackAppToken: slackAppToken || undefined,
      sandboxId: inst.sandboxId,
    });
    const instance = await updateInstance(user.id, inst.id, {
      aiConfigured: result.ok,
      telegramConfigured: result.ok,
      lastError: result.ok ? undefined : result.logs.join('\n').slice(0, 500),
      status: result.ok ? 'running' : 'error',
      config: {
        provider: String(body.provider || 'openai'),
        model: String(body.model || ''),
        baseUrl: String(body.baseUrl || ''),
        hasApiKey: true,
        hasTelegramToken: Boolean(telegramBotToken),
        hasDiscordToken: Boolean(discordBotToken),
        hasSlackToken: Boolean(slackBotToken && slackAppToken),
      },
    });
    return NextResponse.json({ ok: result.ok, logs: result.logs, instance });
  } catch (e) {
    await updateInstance(user.id, inst.id, {
      status: 'error',
      lastError: (e as Error).message.slice(0, 500),
    });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
