import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { readSandboxConfig, writeSandboxConfig, restartDaemon } from '@/lib/gateway-client';
import { ensureWakeSecret, getInstance, updateInstance } from '@/lib/store';
import {
  publicBaseUrl,
  setTelegramWebhook,
  wakeWebhookUrl,
} from '@/lib/telegram-webhook';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
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
    const wakeSecret = inst.wakeSecret || (await ensureWakeSecret(user.id, id));
    return NextResponse.json({
      instanceId: inst.id,
      name: inst.name,
      stored: inst.config || {},
      sandbox,
      wake: {
        secretSet: Boolean(wakeSecret),
        publicBaseUrl: publicBaseUrl() || null,
        webhookUrl: wakeWebhookUrl(inst.id, wakeSecret),
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
    telegramBotToken?: string;
    name?: string;
    restart?: boolean;
    allowAllUsers?: boolean;
  };

  try {
    const result = await writeSandboxConfig(inst.sessionId, {
      provider: body.provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      model: body.model,
      telegramBotToken: body.telegramBotToken,
      mergeExisting: true,
      allowAllUsers: body.allowAllUsers,
      sandboxId: inst.sandboxId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.logs.join(' ') || 'Config write failed', logs: result.logs },
        { status: 400 },
      );
    }

    const name = body.name?.trim();
    let logs = [...result.logs];
    let restartOk = true;
    if (body.restart) {
      const r = await restartDaemon(inst.sessionId, inst.sandboxId);
      logs = [...logs, ...r.logs];
      restartOk = r.ok;
    }

    const wakeSecret = inst.wakeSecret || (await ensureWakeSecret(user.id, id));
    const token = (body.telegramBotToken || '').trim() || inst.telegramBotToken || '';

    // Host webhook = Telegram DM can trigger SDK activity → auto-resume
    if (token) {
      const url = wakeWebhookUrl(inst.id, wakeSecret);
      if (url) {
        if (body.restart) {
          await new Promise((r) => setTimeout(r, 2500));
        }
        const wh = await setTelegramWebhook(token, url);
        logs.push(
          wh.ok
            ? `Telegram host webhook set (auto-resume on DM): ${url}`
            : `Telegram setWebhook failed: ${wh.description || 'unknown'}`,
        );
      } else {
        logs.push(
          'Tip: set PUBLIC_BASE_URL=https://your-public-host so Telegram DMs can wake paused sandboxes (localhost cannot receive webhooks).',
        );
      }
    }

    const instance = await updateInstance(user.id, inst.id, {
      ...(name ? { name } : {}),
      ...(token ? { telegramBotToken: token } : {}),
      wakeSecret,
      aiConfigured: true,
      telegramConfigured: true,
      status: restartOk ? 'running' : 'error',
      lastError: restartOk ? undefined : logs.join('\n').slice(0, 500),
      config: {
        provider: result.meta.provider,
        model: result.meta.model,
        baseUrl: result.meta.baseUrl,
        hasApiKey: result.meta.hasApiKey,
        hasTelegramToken: result.meta.hasTelegramToken,
      },
    });

    return NextResponse.json({
      ok: restartOk,
      logs,
      instance: instance
        ? { ...instance, telegramBotToken: instance.telegramBotToken ? '[stored]' : undefined }
        : null,
      sandbox: result.meta,
      wakeWebhookUrl: token ? wakeWebhookUrl(inst.id, wakeSecret) : null,
    });
  } catch (e) {
    await updateInstance(user.id, inst.id, {
      status: 'error',
      lastError: (e as Error).message.slice(0, 500),
    });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
