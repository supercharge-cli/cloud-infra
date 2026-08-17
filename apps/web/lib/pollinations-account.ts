import {
  findUserById,
  listInstancesForUser,
  setUserPollinations,
  updateInstance,
  type User,
  type UserPollinations,
} from '@/lib/store';
import { PROVIDER_DEFAULTS } from '@/lib/provider-defaults';
import {
  restartDaemon,
  wakeSession,
  writeSandboxConfig,
} from '@/lib/gateway-client';

const STOCK = PROVIDER_DEFAULTS.pollinations;

export type PollenPublicStatus = {
  configured: boolean;
  connected: boolean;
  username?: string;
  name?: string;
  email?: string;
  picture?: string;
  connectedAt?: string;
  expiresAt?: string;
  expired?: boolean;
  workspaces: { total: number; applied: number };
  usage: Record<string, unknown>;
};

export function publicPollinations(user: User | null | undefined): Omit<PollenPublicStatus, 'configured' | 'workspaces' | 'usage'> {
  const p = user?.pollinations;
  if (!p?.accessToken) return { connected: false };
  const expired = Boolean(p.expiresAt && Date.parse(p.expiresAt) < Date.now());
  return {
    connected: !expired,
    username: p.username,
    name: p.name,
    email: p.email,
    picture: p.picture,
    connectedAt: p.connectedAt,
    expiresAt: p.expiresAt,
    expired,
  };
}

export async function fetchPollenProfile(token: string): Promise<{
  username?: string;
  name?: string;
  email?: string;
  picture?: string;
  usage: Record<string, unknown>;
}> {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const usage: Record<string, unknown> = {};
  let username: string | undefined;
  let name: string | undefined;
  let email: string | undefined;
  let picture: string | undefined;

  const urls = [
    'https://enter.pollinations.ai/api/oauth/userinfo',
    'https://enter.pollinations.ai/api/device/userinfo',
    'https://enter.pollinations.ai/api/usage',
    'https://gen.pollinations.ai/v1/usage',
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') continue;
      username =
        username ||
        str(data.preferred_username) ||
        str(data.username) ||
        str(data.login);
      name = name || str(data.name);
      email = email || str(data.email);
      picture = picture || str(data.picture);
      mergeUsage(usage, data);
    } catch {
      /* try next */
    }
  }
  return { username, name, email, picture, usage };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function mergeUsage(into: Record<string, unknown>, raw: Record<string, unknown>) {
  const skip = new Set([
    'sub',
    'id',
    'preferred_username',
    'username',
    'login',
    'name',
    'email',
    'picture',
    'iss',
    'aud',
    'exp',
    'iat',
    'scope',
  ]);
  const pick = [
    'balance',
    'pollen',
    'credits',
    'paid_balance',
    'quest_balance',
    'usage',
    'spent',
    'requests',
    'total',
    'remaining',
    'budget',
    'limit',
  ];
  for (const key of pick) {
    if (raw[key] !== undefined) into[key] = raw[key];
  }
  if (raw.usage && typeof raw.usage === 'object') {
    Object.assign(into, raw.usage as object);
  }
  for (const [k, v] of Object.entries(raw)) {
    if (skip.has(k) || into[k] !== undefined) continue;
    if (typeof v === 'number' || typeof v === 'string') into[k] = v;
  }
}

export async function saveAccountPollinations(input: {
  userId: string;
  accessToken: string;
  expiresIn?: number;
}): Promise<UserPollinations> {
  const profile = await fetchPollenProfile(input.accessToken);
  const now = new Date();
  const expiresAt =
    typeof input.expiresIn === 'number' && input.expiresIn > 0
      ? new Date(now.getTime() + input.expiresIn * 1000).toISOString()
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const rec: UserPollinations = {
    accessToken: input.accessToken,
    connectedAt: now.toISOString(),
    expiresAt,
    username: profile.username,
    name: profile.name,
    email: profile.email,
    picture: profile.picture,
  };
  await setUserPollinations(input.userId, rec);
  return rec;
}

export async function applyPollinationsToInstance(
  inst: { id: string; userId: string; sessionId: string; sandboxId?: string; status: string },
  accessToken: string,
): Promise<{ ok: boolean; error?: string }> {
  if (inst.status === 'destroyed') return { ok: false, error: 'destroyed' };
  const model = STOCK?.defaultModel || 'openai';
  const baseUrl = STOCK?.baseUrl || 'https://gen.pollinations.ai/v1';
  const write = () =>
    writeSandboxConfig(inst.sessionId, {
      instanceId: inst.id,
      provider: 'pollinations',
      apiKey: accessToken,
      baseUrl,
      model,
      mergeExisting: true,
      sandboxId: inst.sandboxId,
    });
  try {
    let result = await write();
    if (!result.ok && inst.sandboxId) {
      await wakeSession(inst.sessionId, { sandboxId: inst.sandboxId, restartDaemon: false });
      result = await write();
    }
    if (!result.ok) return { ok: false, error: result.logs.join(' ') };
    const restarted = await restartDaemon(inst.sessionId, inst.sandboxId);
    await updateInstance(inst.userId, inst.id, {
      aiConfigured: true,
      status: restarted.ok ? 'running' : inst.status === 'paused' ? 'paused' : 'running',
      config: {
        provider: 'pollinations',
        model,
        baseUrl,
        hasApiKey: true,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function applyPollinationsToAllWorkspaces(
  userId: string,
  accessToken: string,
): Promise<{ total: number; applied: number; errors: string[] }> {
  const list = (await listInstancesForUser(userId)).filter((i) => i.status !== 'destroyed');
  const errors: string[] = [];
  let applied = 0;
  for (const inst of list) {
    const r = await applyPollinationsToInstance(inst, accessToken);
    if (r.ok) applied += 1;
    else if (r.error) errors.push(`${inst.name || inst.id}: ${r.error}`);
  }
  return { total: list.length, applied, errors };
}

export async function applySavedPollinationsToNewInstance(input: {
  userId: string;
  instance: { id: string; userId: string; sessionId: string; sandboxId?: string; status: string };
}): Promise<void> {
  const user = await findUserById(input.userId);
  const token = user?.pollinations?.accessToken;
  if (!token) return;
  if (user.pollinations?.expiresAt && Date.parse(user.pollinations.expiresAt) < Date.now()) return;
  await applyPollinationsToInstance(input.instance, token);
}
