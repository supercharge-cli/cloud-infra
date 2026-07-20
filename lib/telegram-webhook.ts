/**
 * Host-side Telegram webhook helpers.
 *
 * Why: in-sandbox long-poll freezes when the VM is paused, so a Telegram DM
 * never becomes E2B "activity". The host receives the update, then runs an
 * SDK op via the gateway (auto-resume per e2b.dev/docs/sandbox/auto-resume).
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
): Promise<{ ok: boolean }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: false }),
  });
  const data = (await res.json()) as { ok?: boolean };
  return { ok: Boolean(data.ok) };
}
