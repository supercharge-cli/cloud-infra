import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import {
  getSandboxPreviewHost,
  readSandboxConfig,
  restartDaemon,
  writeSandboxConfig,
} from '@/lib/gateway-client';
import {
  buildSandboxTelegramWebhookUrl,
  newTelegramWebhookSecret,
  SANDBOX_TG_WEBHOOK_PORT,
} from '@/lib/sandbox-telegram';
import { parseSavedProviders } from '@/lib/saved-providers';
import { ensureWakeSecret, getInstance, updateInstance } from '@/lib/store';
import {
  publicBaseUrl,
  wakeWebhookUrl,
} from '@/lib/telegram-webhook';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const started = performance.now();
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  try {
    const sandbox = await readSandboxConfig(inst.sessionId, inst.sandboxId);
    console.info('[timing] instance config', {
      instanceId: id,
      ms: Math.round(performance.now() - started),
    });
    const wakeSecret = inst.wakeSecret || (await ensureWakeSecret(user.id, id));
    return NextResponse.json({
      instanceId: inst.id,
      name: inst.name,
      stored: inst.config || {},
      sandbox,
      wake: {
        secretSet: Boolean(wakeSecret),
        publicBaseUrl: publicBaseUrl() || null,
        hostWebhookUrl: wakeWebhookUrl(inst.id, wakeSecret),
        mode: inst.telegramWebhookMode || (inst.sandboxTelegramWebhookUrl ? 'sandbox' : 'host'),
        sandboxWebhookUrl: inst.sandboxTelegramWebhookUrl || null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
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
    savedProviders?: Array<{
      id?: string;
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    }>;
    telegramBotToken?: string;
    discordBotToken?: string;
    slackBotToken?: string;
    slackAppToken?: string;
    name?: string;
    restart?: boolean;
    allowAllUsers?: boolean;
  };

  try {
    const token = (body.telegramBotToken || '').trim() || inst.telegramBotToken || '';
    const hasTg =
      Boolean((body.telegramBotToken || '').trim()) ||
      Boolean(inst.telegramBotToken) ||
      Boolean(inst.config?.hasTelegramToken);

    // Sandbox webhook (E2B auto-resume) when we have telegram + sandboxId
    let sandboxWebhookUrl = inst.sandboxTelegramWebhookUrl || '';
    let tgWebhookSecret = inst.telegramWebhookSecret || '';
    let webhookMode: 'sandbox' | 'host' = inst.telegramWebhookMode || 'host';

    if (hasTg && inst.sandboxId) {
      webhookMode = 'sandbox';
      if (!tgWebhookSecret) tgWebhookSecret = newTelegramWebhookSecret();
      const host = await getSandboxPreviewHost(inst.sessionId, SANDBOX_TG_WEBHOOK_PORT);
      sandboxWebhookUrl = buildSandboxTelegramWebhookUrl(
        inst.sandboxId,
        host,
        SANDBOX_TG_WEBHOOK_PORT,
      );
    }

    const result = await writeSandboxConfig(inst.sessionId, {
      instanceId: inst.id,
      provider: body.provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      model: body.model,
      savedProviders: Array.isArray(body.savedProviders)
        ? parseSavedProviders(body.savedProviders)
        : undefined,
      telegramBotToken: body.telegramBotToken,
      discordBotToken: body.discordBotToken,
      slackBotToken: body.slackBotToken,
      slackAppToken: body.slackAppToken,
      mergeExisting: true,
      allowAllUsers: body.allowAllUsers,
      sandboxId: inst.sandboxId,
      telegramWebhookUrl: webhookMode === 'sandbox' ? sandboxWebhookUrl : undefined,
      telegramWebhookSecret: webhookMode === 'sandbox' ? tgWebhookSecret : undefined,
      telegramWebhookPort:
        webhookMode === 'sandbox' ? SANDBOX_TG_WEBHOOK_PORT : undefined,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.logs.join(' ') || 'Config write failed', logs: result.logs },
        { status: 400 },
      );
    }

    const name = body.name?.trim();
    let logs = [...result.logs];
    // Always start/restart the bot after a successful config write so users
    // don't get a silent "saved env but no daemon" state (Save-only was easy to miss).
    const shouldRestart = body.restart !== false;
    let restartOk = true;
    if (shouldRestart) {
      const r = await restartDaemon(inst.sessionId, inst.sandboxId);
      logs = [...logs, ...r.logs];
      restartOk = r.ok;
    }

    const wakeSecret = inst.wakeSecret || (await ensureWakeSecret(user.id, id));
    const anyChannel =
      result.meta.hasTelegramToken || result.meta.hasDiscordToken || result.meta.hasSlackToken;

    if (webhookMode === 'sandbox' && token && sandboxWebhookUrl) {
      // While *running*, bot long-polls (deleteWebhook already done in restartDaemon).
      // Do NOT setWebhook here — that steals getUpdates. Host arms the template
      // public URL automatically when the sandbox pauses (lifecycle + cron).
      logs.push(
        `Telegram auto-wake ready (no user action): when paused, webhook → ${sandboxWebhookUrl}`,
      );
      logs.push(
        'Users only paste the bot token once. Hosting sets Telegram webhook on pause; E2B auto-resumes on the next DM.',
      );
    } else if (token || result.meta.hasTelegramToken) {
      logs.push(
        'Telegram: long-poll while running; host wake webhook arms automatically when paused.',
      );
      const url = wakeWebhookUrl(inst.id, wakeSecret);
      if (url) logs.push(`Host wake URL ready: ${url}`);
    }
    if (result.meta.hasDiscordToken || result.meta.hasSlackToken) {
      logs.push(
        'Discord/Slack: after idle pause, use Wake / resume on the dashboard (no host webhook for those channels).',
      );
    }

    const instance = await updateInstance(user.id, inst.id, {
      ...(name ? { name } : {}),
      ...(token ? { telegramBotToken: token } : {}),
      wakeSecret,
      telegramWebhookMode: webhookMode,
      ...(sandboxWebhookUrl ? { sandboxTelegramWebhookUrl: sandboxWebhookUrl } : {}),
      ...(tgWebhookSecret ? { telegramWebhookSecret: tgWebhookSecret } : {}),
      aiConfigured: true,
      telegramConfigured: anyChannel,
      status: restartOk ? 'running' : 'error',
      lastError: restartOk ? undefined : logs.join('\n').slice(0, 500),
      config: {
        provider: result.meta.provider,
        model: result.meta.model,
        baseUrl: result.meta.baseUrl,
        hasApiKey: result.meta.hasApiKey,
        hasTelegramToken: result.meta.hasTelegramToken,
        hasDiscordToken: result.meta.hasDiscordToken,
        hasSlackToken: result.meta.hasSlackToken,
      },
    });

    return NextResponse.json({
      ok: restartOk,
      logs,
      instance: instance
        ? { ...instance, telegramBotToken: instance.telegramBotToken ? '[stored]' : undefined }
        : null,
      sandbox: result.meta,
      telegramWebhookMode: webhookMode,
      sandboxTelegramWebhookUrl: sandboxWebhookUrl || null,
      wakeWebhookUrl:
        webhookMode === 'host' && (token || result.meta.hasTelegramToken)
          ? wakeWebhookUrl(inst.id, wakeSecret)
          : null,
    });
  } catch (e) {
    await updateInstance(user.id, inst.id, {
      status: 'error',
      lastError: (e as Error).message.slice(0, 500),
    });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
