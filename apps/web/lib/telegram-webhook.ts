/**
 * Telegram webhook helpers.
 *
 * Preferred (E2B auto-resume): Telegram → sandbox public URL
 *   https://8788-{sandboxId}.e2b.app/telegram
 *   (daemon listens with TELEGRAM_WEBHOOK_PORT; traffic wakes paused VM)
 *   Docs: https://e2b.dev/docs/sandbox/auto-resume
 *
 * Legacy host path: paused → Vercel host webhook → gateway SDK wake → long-poll.
 * Only used when telegramWebhookMode !== 'sandbox'.
 */

import {
  buildSandboxTelegramWebhookUrl,
  setSandboxTelegramWebhook,
} from './sandbox-telegram';

export function publicBaseUrl(): string {
  return (
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim()?.replace(/^/, 'https://') ||
    ''
  ).replace(/\/$/, '');
}

export function wakeWebhookPath(instanceId: string, wakeSecret: string): string {
  return `/api/telegram/wake/${encodeURIComponent(instanceId)}/${encodeURIComponent(wakeSecret)}`;
}

export function wakeWebhookUrl(instanceId: string, wakeSecret: string): string | null {
  const base = publicBaseUrl();
  if (!base || base.includes('127.0.0.1') || base.includes('localhost')) {
    // Telegram cannot reach localhost without a tunnel
    return null;
  }
  return `${base}${wakeWebhookPath(instanceId, wakeSecret)}`;
}

export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken?: string,
): Promise<{ ok: boolean; description?: string }> {
  const body: Record<string, unknown> = {
    url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  };
  if (secretToken) body.secret_token = secretToken;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  return { ok: Boolean(data.ok), description: data.description };
}

export async function deleteTelegramWebhook(
  botToken: string,
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: false }),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  return { ok: Boolean(data.ok), description: data.description };
}

/** Notify the user in Telegram (best-effort; never throws). */
export async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    /* ignore */
  }
}

/**
 * Keep Telegram pointed at the right place for auto-resume.
 *
 * - **sandbox mode** (preferred): always ensure setWebhook → sandbox public URL.
 *   Pause/resume does not change the webhook. E2B wakes the VM on traffic.
 * - **host mode** (legacy): arm host webhook when paused; clear when running
 *   so daemon long-poll owns Telegram.
 */
export async function syncTelegramWakeWebhook(input: {
  botToken?: string;
  instanceId: string;
  wakeSecret?: string;
  sandboxState: string;
  /** Prefer sandbox public URL webhook when available */
  mode?: 'sandbox' | 'host';
  sandboxId?: string;
  sandboxWebhookUrl?: string;
  telegramWebhookSecret?: string;
}): Promise<string | null> {
  const token = (input.botToken || '').trim();
  if (!token) return null;

  const mode =
    input.mode ||
    (input.sandboxWebhookUrl || input.sandboxId ? 'sandbox' : 'host');

  if (mode === 'sandbox') {
    const url =
      (input.sandboxWebhookUrl || '').trim() ||
      (input.sandboxId
        ? buildSandboxTelegramWebhookUrl(input.sandboxId)
        : '');
    if (!url) {
      return 'sandbox webhook: missing sandboxId/url — cannot setWebhook';
    }
    const wh = await setSandboxTelegramWebhook(
      token,
      url,
      input.telegramWebhookSecret,
    );
    return wh.ok
      ? `sandbox webhook armed (E2B auto-resume): ${url}`
      : `sandbox setWebhook failed: ${wh.description || 'unknown'}`;
  }

  // Legacy host arm/clear
  if (input.sandboxState === 'paused') {
    const secret = (input.wakeSecret || '').trim();
    if (!secret) return 'paused: no wakeSecret — cannot arm host webhook';
    const url = wakeWebhookUrl(input.instanceId, secret);
    if (!url) {
      return 'paused: PUBLIC_BASE_URL not set (or localhost) — cannot arm Telegram wake webhook';
    }
    const wh = await setTelegramWebhook(token, url);
    return wh.ok
      ? `paused: host webhook armed for auto-resume`
      : `paused: setWebhook failed: ${wh.description || 'unknown'}`;
  }

  if (input.sandboxState === 'running') {
    const wh = await deleteTelegramWebhook(token);
    return wh.ok
      ? `running: host webhook cleared (daemon long-poll)`
      : `running: deleteWebhook failed: ${wh.description || 'unknown'}`;
  }

  return null;
}
