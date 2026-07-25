import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getSandboxPreviewHost, setupAiAndTelegram } from '@/lib/gateway-client';
import {
  buildSandboxTelegramWebhookUrl,
  newTelegramWebhookSecret,
  SANDBOX_TG_WEBHOOK_PORT,
} from '@/lib/sandbox-telegram';
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
    let sandboxWebhookUrl: string | undefined;
    let tgWebhookSecret: string | undefined;
    let webhookMode: 'sandbox' | 'host' = 'host';

    if (telegramBotToken && inst.sandboxId) {
      webhookMode = 'sandbox';
      tgWebhookSecret = inst.telegramWebhookSecret || newTelegramWebhookSecret();
      const host = await getSandboxPreviewHost(inst.sessionId, SANDBOX_TG_WEBHOOK_PORT);
      sandboxWebhookUrl = buildSandboxTelegramWebhookUrl(
        inst.sandboxId,
        host,
        SANDBOX_TG_WEBHOOK_PORT,
      );
    }

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
      telegramWebhookUrl: sandboxWebhookUrl,
      telegramWebhookSecret: tgWebhookSecret,
      telegramWebhookPort: sandboxWebhookUrl ? SANDBOX_TG_WEBHOOK_PORT : undefined,
    });

    const logs = [...result.logs];
    if (webhookMode === 'sandbox' && sandboxWebhookUrl) {
      // Store URL only — setWebhook is armed automatically on pause (lifecycle/cron).
      // While running the bot long-polls; setting webhook now would break getUpdates.
      logs.push(
        `Telegram auto-wake registered: ${sandboxWebhookUrl} (armed when sandbox pauses — no user steps)`,
      );
    }

    const instance = await updateInstance(user.id, inst.id, {
      aiConfigured: result.ok,
      telegramConfigured: result.ok,
      lastError: result.ok ? undefined : logs.join('\n').slice(0, 500),
      status: result.ok ? 'running' : 'error',
      ...(telegramBotToken ? { telegramBotToken } : {}),
      telegramWebhookMode: webhookMode,
      ...(sandboxWebhookUrl ? { sandboxTelegramWebhookUrl: sandboxWebhookUrl } : {}),
      ...(tgWebhookSecret ? { telegramWebhookSecret: tgWebhookSecret } : {}),
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
    return NextResponse.json({
      ok: result.ok,
      logs,
      instance,
      telegramWebhookMode: webhookMode,
      sandboxTelegramWebhookUrl: sandboxWebhookUrl || null,
    });
  } catch (e) {
    await updateInstance(user.id, inst.id, {
      status: 'error',
      lastError: (e as Error).message.slice(0, 500),
    });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
