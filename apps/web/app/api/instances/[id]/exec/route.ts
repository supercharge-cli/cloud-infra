import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getPlan, isSubscriptionActive } from '@/lib/billing';
import { execInSession, redactSecrets } from '@/lib/gateway-client';
import { getInstance, publicInstance, updateInstance } from '@/lib/store';

/** Resume + long shell can exceed default serverless window */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const MAX_COMMAND_LEN = 8_000;
const MAX_TIMEOUT_SEC = 300;
const DEFAULT_TIMEOUT_SEC = 120;
const DEFAULT_CWD = '/home/user/workspace';
const MAX_OUTPUT_CHARS = 80_000;

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
  if (inst.status === 'destroyed') {
    return NextResponse.json({ error: 'Instance destroyed' }, { status: 410 });
  }

  if (!isSubscriptionActive(inst.paidUntil)) {
    const plan = getPlan();
    return NextResponse.json(
      {
        error: 'Subscription expired',
        message: `Renew for ₹${plan.priceInr} or $${plan.priceUsd}/month to run commands.`,
        code: 'PAYMENT_REQUIRED',
        paidUntil: inst.paidUntil || null,
      },
      { status: 402 },
    );
  }

  let body: { command?: string; cwd?: string; timeout?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const command = String(body.command || '').trim();
  if (!command) {
    return NextResponse.json({ error: 'command is required' }, { status: 400 });
  }
  if (command.length > MAX_COMMAND_LEN) {
    return NextResponse.json(
      { error: `command too long (max ${MAX_COMMAND_LEN} chars)` },
      { status: 400 },
    );
  }

  let cwd = String(body.cwd || DEFAULT_CWD).trim() || DEFAULT_CWD;
  // Basic path hygiene — gateway also enforces workspace rules
  if (cwd.includes('\0') || cwd.includes('..')) {
    return NextResponse.json({ error: 'Invalid cwd' }, { status: 400 });
  }
  if (!cwd.startsWith('/')) {
    cwd = `${DEFAULT_CWD.replace(/\/$/, '')}/${cwd}`;
  }

  const timeoutRaw = Number(body.timeout);
  const timeout = Number.isFinite(timeoutRaw)
    ? Math.min(MAX_TIMEOUT_SEC, Math.max(5, Math.round(timeoutRaw)))
    : DEFAULT_TIMEOUT_SEC;

  try {
    // Gateway will reattach + Sandbox.connect when paused (same path as Telegram wake).
    const result = await execInSession(inst.sessionId, command, {
      timeout,
      cwd,
      sandboxId: inst.sandboxId,
    });

    const secrets: string[] = [];
    if (inst.telegramBotToken) secrets.push(inst.telegramBotToken);

    const stdout = redactSecrets(String(result.stdout || ''), secrets).slice(
      0,
      MAX_OUTPUT_CHARS,
    );
    const stderr = redactSecrets(String(result.stderr || result.message || ''), secrets).slice(
      0,
      MAX_OUTPUT_CHARS,
    );

    // Mark running after a successful gateway touch (command may still exit non-zero)
    if (result.error !== true || result.exitCode !== undefined) {
      await updateInstance(user.id, inst.id, {
        status: 'running',
        lastError: undefined,
      }).catch(() => undefined);
    }

    const exitCode =
      typeof result.exitCode === 'number'
        ? result.exitCode
        : result.success === false
          ? 1
          : 0;

    return NextResponse.json({
      ok: exitCode === 0 && !result.error,
      exitCode,
      stdout,
      stderr,
      timedOut: Boolean((result as { timedOut?: boolean }).timedOut),
      cwd,
      timeout,
      command,
      sandboxId: inst.sandboxId,
      instance: publicInstance(inst),
      message: result.message ? redactSecrets(String(result.message), secrets) : undefined,
    });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await updateInstance(user.id, inst.id, {
      status: 'error',
      lastError: msg,
    }).catch(() => undefined);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
