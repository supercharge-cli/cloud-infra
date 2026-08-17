import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  exchangeCode,
  OAUTH_COOKIE,
  oauthCookieOptions,
  connectedPageUrl,
  verifyOauthState,
} from '@/lib/pollinations-byop';
import { PROVIDER_DEFAULTS } from '@/lib/provider-defaults';
import {
  readSandboxConfig,
  restartDaemon,
  type SandboxConfigView,
  wakeSession,
  writeSandboxConfig,
} from '@/lib/gateway-client';
import { getInstance, updateInstance } from '@/lib/store';

export const dynamic = 'force-dynamic';

function fail(instanceId: string, fromApp: boolean, error: string) {
  const res = NextResponse.redirect(connectedPageUrl({ instanceId, fromApp, error }));
  res.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').trim();
  const state = (url.searchParams.get('state') || '').trim();
  const denied = url.searchParams.get('error');

  const store = await cookies();
  const raw = store.get(OAUTH_COOKIE)?.value || '';
  const oauth = verifyOauthState(raw);

  if (!oauth) {
    const res = NextResponse.redirect(
      new URL('/pollinations/connected?error=session_expired', url.origin),
    );
    res.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
    return res;
  }

  if (denied) {
    return fail(oauth.instanceId, oauth.fromApp, 'Authorization cancelled');
  }
  if (!code || state !== oauth.nonce) {
    return fail(oauth.instanceId, oauth.fromApp, 'Invalid OAuth callback');
  }

  const inst = await getInstance(oauth.userId, oauth.instanceId);
  if (!inst || inst.status === 'destroyed') {
    return fail(oauth.instanceId, oauth.fromApp, 'Instance not found');
  }

  try {
    const token = await exchangeCode({ code, verifier: oauth.verifier });
    const stock = PROVIDER_DEFAULTS.pollinations;
    let existing: SandboxConfigView | undefined;
    try {
      existing = await readSandboxConfig(inst.sessionId, inst.sandboxId);
    } catch {
      if (inst.sandboxId) {
        await wakeSession(inst.sessionId, { sandboxId: inst.sandboxId, restartDaemon: false });
        existing = await readSandboxConfig(inst.sessionId, inst.sandboxId);
      }
    }

    const model =
      (existing?.provider === 'pollinations' && existing.model?.trim()) ||
      stock?.defaultModel ||
      'openai';
    const baseUrl = stock?.baseUrl || 'https://gen.pollinations.ai/v1';

    const write = async () =>
      writeSandboxConfig(inst.sessionId, {
        instanceId: inst.id,
        provider: 'pollinations',
        apiKey: token.accessToken,
        baseUrl,
        model,
        mergeExisting: true,
        sandboxId: inst.sandboxId,
      });

    let result = await write();
    if (!result.ok && inst.sandboxId) {
      await wakeSession(inst.sessionId, { sandboxId: inst.sandboxId, restartDaemon: false });
      result = await write();
    }
    if (!result.ok) {
      return fail(
        inst.id,
        oauth.fromApp,
        result.logs.join(' ') || 'Could not save the Pollinations key on the sandbox',
      );
    }

    const restarted = await restartDaemon(inst.sessionId, inst.sandboxId);
    await updateInstance(oauth.userId, inst.id, {
      aiConfigured: true,
      status: restarted.ok ? 'running' : inst.status,
      lastError: restarted.ok ? undefined : restarted.logs.join('\n').slice(0, 500),
      config: {
        provider: result.meta.provider || 'pollinations',
        model: result.meta.model || model,
        baseUrl: result.meta.baseUrl || baseUrl,
        hasApiKey: true,
        hasTelegramToken: result.meta.hasTelegramToken,
        hasDiscordToken: result.meta.hasDiscordToken,
        hasSlackToken: result.meta.hasSlackToken,
      },
    });

    const ok = NextResponse.redirect(
      connectedPageUrl({ instanceId: inst.id, fromApp: oauth.fromApp }),
    );
    ok.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 });
    return ok;
  } catch (e) {
    return fail(inst.id, oauth.fromApp, (e as Error).message);
  }
}
