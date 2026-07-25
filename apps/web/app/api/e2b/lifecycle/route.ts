import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  getInstanceBySandboxId,
  updateInstanceById,
} from '@/lib/store';
import { syncTelegramWakeWebhook } from '@/lib/telegram-webhook';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * E2B sandbox lifecycle webhook.
 *
 * Register once (project-level) with events including:
 *   sandbox.lifecycle.paused, sandbox.lifecycle.resumed, sandbox.lifecycle.killed
 * URL:  ${PUBLIC_BASE_URL}/api/e2b/lifecycle
 * Auth: optional E2B_LIFECYCLE_WEBHOOK_SECRET → verify e2b-signature header
 *       (sha256 base64 of secret+rawBody, trailing '=' stripped — see E2B docs)
 *
 * On **paused**: mark instance paused. Sandbox webhook mode keeps Telegram pointed
 * at the sandbox public URL (E2B auto-resumes on traffic). Host mode arms Vercel wake.
 * On **resumed/created**: mark running. Host mode clears webhook for long-poll.
 * On **killed**: mark error so dashboard doesn't show a dead box as resumable forever.
 */

type LifecyclePayload = {
  id?: string;
  type?: string;
  event_label?: string;
  sandbox_id?: string;
  sandboxId?: string;
  timestamp?: string;
};

function verifySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = createHash('sha256')
    .update(secret + rawBody)
    .digest('base64')
    .replace(/=+$/, '');
  return expected === header.trim();
}

function mapEventToState(
  type: string,
  label: string,
): 'paused' | 'running' | 'error' | null {
  const t = `${type} ${label}`.toLowerCase();
  if (t.includes('paused') || t.includes('.pause')) return 'paused';
  if (t.includes('resumed') || t.includes('created') || t.includes('.resume')) {
    return 'running';
  }
  if (t.includes('killed') || t.includes('kill')) return 'error';
  // "updated" alone is not a state transition we care about
  return null;
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.E2B_LIFECYCLE_WEBHOOK_SECRET?.trim() || '';
  if (secret) {
    const sig = req.headers.get('e2b-signature');
    if (!verifySignature(secret, raw, sig)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else if (process.env.VERCEL === '1' && process.env.NODE_ENV === 'production') {
    // Refuse open lifecycle endpoint in prod unless secret is set
    return NextResponse.json(
      { error: 'Set E2B_LIFECYCLE_WEBHOOK_SECRET to accept lifecycle events' },
      { status: 503 },
    );
  }

  let body: LifecyclePayload = {};
  try {
    body = JSON.parse(raw || '{}') as LifecyclePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sandboxId = (body.sandbox_id || body.sandboxId || '').trim();
  const eventType = String(body.type || '');
  const eventLabel = String(body.event_label || '');
  const state = mapEventToState(eventType, eventLabel);

  if (!sandboxId) {
    return NextResponse.json({ ok: true, ignored: 'no sandbox_id' });
  }
  if (!state) {
    return NextResponse.json({
      ok: true,
      ignored: `event ${eventType || eventLabel || 'unknown'}`,
    });
  }

  const inst = await getInstanceBySandboxId(sandboxId);
  if (!inst) {
    // Not one of our tenants (or already destroyed) — ack so E2B doesn't retry forever
    return NextResponse.json({ ok: true, ignored: 'unknown sandbox' });
  }

  const logs: string[] = [];
  const next = await updateInstanceById(inst.id, {
    status: state === 'error' ? 'error' : state,
    lastError:
      state === 'error'
        ? `E2B lifecycle: sandbox ${eventLabel || eventType || 'killed'}`.slice(0, 500)
        : state === 'paused'
          ? undefined
          : inst.lastError,
  });
  logs.push(`status → ${next?.status || state}`);

  if (inst.telegramBotToken && (state === 'paused' || state === 'running')) {
    const mode =
      inst.telegramWebhookMode ||
      (inst.sandboxTelegramWebhookUrl ? 'sandbox' : 'host');
    // Sandbox mode: re-affirm setWebhook on pause only (running keeps same URL)
    if (mode === 'sandbox' && state === 'running') {
      logs.push('sandbox webhook mode — Telegram stays on sandbox public URL');
    } else {
      const action = await syncTelegramWakeWebhook({
        botToken: inst.telegramBotToken,
        instanceId: inst.id,
        wakeSecret: inst.wakeSecret,
        sandboxState: state,
        mode,
        sandboxId: inst.sandboxId,
        sandboxWebhookUrl: inst.sandboxTelegramWebhookUrl,
        telegramWebhookSecret: inst.telegramWebhookSecret,
      });
      if (action) logs.push(action);
    }
  }

  console.log(
    `[e2b-lifecycle] sandbox=${sandboxId} instance=${inst.id} event=${eventType || eventLabel} → ${state}`,
  );

  return NextResponse.json({
    ok: true,
    instanceId: inst.id,
    state,
    logs,
  });
}

/** Health / register check */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'vectra-e2b-lifecycle',
    events: [
      'sandbox.lifecycle.paused',
      'sandbox.lifecycle.resumed',
      'sandbox.lifecycle.killed',
      'sandbox.lifecycle.created',
    ],
  });
}
