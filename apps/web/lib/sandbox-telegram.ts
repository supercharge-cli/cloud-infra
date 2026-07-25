/**
 * Sandbox-native Telegram webhook (E2B auto-resume on request).
 *
 * Docs: https://e2b.dev/docs/sandbox/auto-resume
 *       https://e2b.dev/docs/network/public-url
 *
 * Flow:
 *   Telegram setWebhook → https://{port}-{sandboxId}.e2b.app/telegram
 *   DM hits that URL → E2B resumes paused sandbox (memory snapshot) →
 *   xibecode daemon HTTP handler processes the update.
 *
 * Requires xibecode with TELEGRAM_WEBHOOK_PORT / TELEGRAM_WEBHOOK_URL support.
 * Prefer this over host (Vercel) wake webhook + long-poll.
 */

import { nanoid } from 'nanoid';

/** Fixed port the daemon webhook HTTP server listens on inside the sandbox. */
export const SANDBOX_TG_WEBHOOK_PORT = 8788;

export function sandboxTelegramWebhookPath(): string {
  return '/telegram';
}

/**
 * Build public HTTPS URL for the in-sandbox Telegram webhook.
 * Prefer gateway getHost(); fall back to E2B host template (docs: e2b.app).
 */
export function buildSandboxTelegramWebhookUrl(
  sandboxId: string,
  hostOrUrl?: string | null,
  port: number = SANDBOX_TG_WEBHOOK_PORT,
): string {
  const fromHost = (hostOrUrl || '').trim();
  if (fromHost) {
    const base = fromHost.replace(/\/$/, '');
    const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`;
    if (/\/telegram\/?$/i.test(withScheme)) return withScheme.replace(/\/$/, '');
    return `${withScheme}${sandboxTelegramWebhookPath()}`;
  }
  const domain =
    process.env.XIBECODE_E2B_PREVIEW_DOMAIN?.trim() ||
    process.env.E2B_DOMAIN?.trim() ||
    'e2b.app';
  return `https://${port}-${sandboxId}.${domain}${sandboxTelegramWebhookPath()}`;
}

/** Telegram setWebhook pointing at the sandbox public URL. */
export async function setSandboxTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string,
): Promise<{ ok: boolean; description?: string }> {
  const body: Record<string, unknown> = {
    url: webhookUrl,
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

export function newTelegramWebhookSecret(): string {
  // Telegram secret_token: 1–256 chars [A-Za-z0-9_-]
  return nanoid(32);
}
