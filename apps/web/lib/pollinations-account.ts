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

export type PollenBalance = {
  remaining?: number;
  paid?: number;
  quest?: number;
  budget?: number;
  currency: 'pollen';
  note?: string;
  raw: Record<string, unknown>;
};

export type PollenUsageRow = {
  at?: string;
  model?: string;
  cost?: number;
  tokens?: number;
  kind?: string;
};

export type PollenDailyRow = {
  day?: string;
  cost?: number;
  requests?: number;
};

export type PollenModelPrice = {
  name: string;
  title?: string;
  category: string;
  inPerMillion?: number;
  outPerMillion?: number;
  perImage?: number;
  label: string;
};

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
  balance?: PollenBalance;
  recent?: PollenUsageRow[];
  daily?: PollenDailyRow[];
  models?: PollenModelPrice[];
  scopeHint?: string;
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

async function pollenGet(url: string, token?: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function parseBalance(raw: unknown): PollenBalance {
  const rec = asRecord(raw) || {};
  const inner = asRecord(rec.balance) || asRecord(rec.data) || rec;
  return {
    remaining:
      num(inner.remaining) ??
      num(inner.balance) ??
      num(inner.total) ??
      num(inner.pollen) ??
      num(rec.remaining) ??
      num(rec.balance),
    paid: num(inner.paid) ?? num(inner.paid_balance) ?? num(inner.paidPollen) ?? num(rec.paid),
    quest: num(inner.quest) ?? num(inner.quest_balance) ?? num(inner.questPollen) ?? num(rec.quest),
    budget: num(inner.budget) ?? num(inner.limit) ?? num(rec.budget),
    currency: 'pollen',
    note: str(rec.message) || str(rec.note),
    raw: rec,
  };
}

export function parseUsageRows(raw: unknown): PollenUsageRow[] {
  const rec = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(rec?.items)
      ? rec.items
      : Array.isArray(rec?.data)
        ? rec.data
        : Array.isArray(rec?.usage)
          ? rec.usage
          : Array.isArray(rec?.requests)
            ? rec.requests
            : [];
  return list.slice(0, 30).map((item) => {
    const r = asRecord(item) || {};
    return {
      at: str(r.createdAt) || str(r.created_at) || str(r.timestamp) || str(r.date) || str(r.at),
      model: str(r.model) || str(r.modelName),
      cost: num(r.cost) || num(r.pollen) || num(r.spent) || num(r.amount),
      tokens: num(r.total_tokens) || num(r.tokens) || num(r.tokenCount),
      kind: str(r.type) || str(r.kind) || str(r.endpoint),
    };
  });
}

export function parseDailyRows(raw: unknown): PollenDailyRow[] {
  const rec = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(rec?.items)
      ? rec.items
      : Array.isArray(rec?.data)
        ? rec.data
        : Array.isArray(rec?.days)
          ? rec.days
          : [];
  return list.slice(0, 14).map((item) => {
    const r = asRecord(item) || {};
    return {
      day: str(r.day) || str(r.date) || str(r.createdAt),
      cost: num(r.cost) || num(r.spent) || num(r.pollen) || num(r.total),
      requests: num(r.requests) || num(r.count) || num(r.n),
    };
  });
}

function formatPriceLabel(p: {
  inPerMillion?: number;
  outPerMillion?: number;
  perImage?: number;
}): string {
  if (p.perImage != null) {
    return p.perImage === 0 ? 'free / image' : `${trimNum(p.perImage)} pollen / image`;
  }
  const parts: string[] = [];
  if (p.inPerMillion != null) parts.push(`${trimNum(p.inPerMillion)} / 1M in`);
  if (p.outPerMillion != null) parts.push(`${trimNum(p.outPerMillion)} / 1M out`);
  return parts.length ? `${parts.join(' · ')} pollen` : 'see catalog';
}

function trimNum(n: number): string {
  if (n === 0) return '0';
  if (n >= 10) return n.toFixed(2).replace(/\.00$/, '');
  if (n >= 1) return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return n.toPrecision(3);
}

export function parseModelPrices(raw: unknown): PollenModelPrice[] {
  const rec = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(rec?.data)
      ? rec.data
      : Array.isArray(rec?.models)
        ? rec.models
        : [];
  const out: PollenModelPrice[] = [];
  for (const item of list) {
    const r = asRecord(item);
    if (!r) continue;
    const name = str(r.name) || str(r.id);
    if (!name) continue;
    const pricing = asRecord(r.pricing) || {};
    const inTok = num(pricing.promptTextTokens);
    const outTok = num(pricing.completionTextTokens);
    const img = num(pricing.completionImageTokens) ?? num(pricing.perImage);
    const row: PollenModelPrice = {
      name,
      title: str(r.title) || str(r.description),
      category: str(r.category) || (Array.isArray(r.output_modalities) ? String(r.output_modalities[0] || 'other') : 'other'),
      inPerMillion: inTok != null ? inTok * 1_000_000 : undefined,
      outPerMillion: outTok != null ? outTok * 1_000_000 : undefined,
      perImage: img,
      label: '',
    };
    row.label = formatPriceLabel(row);
    out.push(row);
  }
  const rank: Record<string, number> = { text: 0, image: 1, audio: 2, video: 3, embedding: 4 };
  out.sort((a, b) => {
    const c = (rank[a.category] ?? 9) - (rank[b.category] ?? 9);
    if (c !== 0) return c;
    const ap = a.inPerMillion ?? a.perImage ?? 99;
    const bp = b.inPerMillion ?? b.perImage ?? 99;
    return ap - bp;
  });
  return out;
}

export async function fetchPollenCatalog(): Promise<PollenModelPrice[]> {
  try {
    const { ok, data } = await pollenGet('https://gen.pollinations.ai/models?community=false');
    if (!ok) return [];
    return parseModelPrices(data);
  } catch {
    return [];
  }
}

export async function fetchPollenProfile(token: string): Promise<{
  username?: string;
  name?: string;
  email?: string;
  picture?: string;
  usage: Record<string, unknown>;
  balance?: PollenBalance;
  recent?: PollenUsageRow[];
  daily?: PollenDailyRow[];
  scopeHint?: string;
}> {
  const usage: Record<string, unknown> = {};
  let username: string | undefined;
  let name: string | undefined;
  let email: string | undefined;
  let picture: string | undefined;
  let balance: PollenBalance | undefined;
  let recent: PollenUsageRow[] = [];
  let daily: PollenDailyRow[] = [];
  let scopeHint: string | undefined;

  const hits = await Promise.allSettled([
    pollenGet('https://gen.pollinations.ai/account/profile', token),
    pollenGet('https://gen.pollinations.ai/account/balance', token),
    pollenGet('https://gen.pollinations.ai/account/usage', token),
    pollenGet('https://gen.pollinations.ai/account/usage/daily', token),
    pollenGet('https://enter.pollinations.ai/api/oauth/userinfo', token),
    pollenGet('https://enter.pollinations.ai/api/device/userinfo', token),
  ]);

  for (const hit of hits) {
    if (hit.status !== 'fulfilled') continue;
    const { ok, status, data } = hit.value;
    const rec = asRecord(data);
    if (status === 403) {
      scopeHint = 'Reconnect so Vectra can read Pollen balance (account:usage).';
    }
    if (!ok || !rec) continue;
    username =
      username ||
      str(rec.preferred_username) ||
      str(rec.username) ||
      str(rec.githubUsername) ||
      str(rec.login);
    name = name || str(rec.name);
    email = email || str(rec.email);
    picture = picture || str(rec.picture) || str(rec.image);
    mergeUsage(usage, rec);
  }

  const balHit = hits[1];
  if (balHit.status === 'fulfilled' && balHit.value.ok) {
    balance = parseBalance(balHit.value.data);
    if (balance.remaining != null) usage.remaining = balance.remaining;
    if (balance.paid != null) usage.paid = balance.paid;
    if (balance.quest != null) usage.quest = balance.quest;
  }

  const useHit = hits[2];
  if (useHit.status === 'fulfilled' && useHit.value.ok) {
    recent = parseUsageRows(useHit.value.data);
  }
  const dayHit = hits[3];
  if (dayHit.status === 'fulfilled' && dayHit.value.ok) {
    daily = parseDailyRows(dayHit.value.data);
  }

  return { username, name, email, picture, usage, balance, recent, daily, scopeHint };
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
      : new Date(now.getTime() + 150 * 24 * 60 * 60 * 1000).toISOString();
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
