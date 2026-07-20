/**
 * Host-side Telegram webhook helpers.
 *
 * Why: XibeCode daemon long-polls getUpdates. That freezes when the E2B sandbox
 * pauses, so a Telegram DM cannot wake the VM alone.
 *
 * Lifecycle (must not fight the daemon):
 * - **paused** → set host webhook so the next DM hits Vercel → gateway resume
 * - **running** → delete host webhook so the daemon's getUpdates works
 *
 * Never leave the host webhook set while the daemon is running: Telegram delivers
 * either to the webhook OR to long-poll, not both. Re-setting the webhook after
 * restart was breaking "auto resume" from the user's POV (sandbox woke, bot silent).
 */

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
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    }),
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
 * Arm host wake webhook when the sandbox is paused (so the next DM can resume).
 * Clear it when running so the in-sandbox daemon long-poll owns Telegram.
 */
export async function syncTelegramWakeWebhook(input: {
  botToken?: string;
  instanceId: string;
  wakeSecret?: string;
  sandboxState: string;
}): Promise<string | null> {
  const token = (input.botToken || '').trim();
  if (!token) return null;

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
    // Daemon will also deleteWebhook on start; host must not steal getUpdates.
    const wh = await deleteTelegramWebhook(token);
    return wh.ok
      ? `running: host webhook cleared (daemon long-poll)`
      : `running: deleteWebhook failed: ${wh.description || 'unknown'}`;
  }

  return null;
}
