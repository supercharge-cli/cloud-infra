import { nanoid } from 'nanoid';
import { getDb } from './mongodb';
import { hashPassword, verifyPassword } from './auth';

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

export type InstanceStatus = 'creating' | 'running' | 'paused' | 'error' | 'destroyed';

export type InstanceConfigMeta = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  hasApiKey?: boolean;
  hasTelegramToken?: boolean;
};

export type Instance = {
  id: string;
  userId: string;
  name: string;
  sessionId: string;
  sandboxId?: string;
  status: InstanceStatus;
  aiConfigured: boolean;
  telegramConfigured: boolean;
  plan: 'hosting-4c8g';
  config?: InstanceConfigMeta;
  /** Random secret in Telegram webhook URL — host receives DMs and wakes sandbox via SDK. */
  wakeSecret?: string;
  /**
   * Bot token for host-side setWebhook re-registration.
   * Daemon deletes webhooks on start (long-poll); host re-sets after wake.
   */
  telegramBotToken?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export async function createUser(email: string, password: string): Promise<User> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    throw new Error('Valid email is required');
  }
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const existing = await db.collection<User>('users').findOne({ email: normalized });
  if (existing) throw new Error('Email already registered');

  const user: User = {
    id: nanoid(12),
    email: normalized,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  await db.collection<User>('users').insertOne(user);
  return user;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  return db.collection<User>('users').findOne({ email: email.trim().toLowerCase() });
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function listInstances(
  userId: string,
  opts?: { includeDestroyed?: boolean },
): Promise<Instance[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = { userId };
  // Paused/running/error always listed so the owner can resume. Destroyed hidden by default.
  if (!opts?.includeDestroyed) {
    filter.status = { $ne: 'destroyed' };
  }
  return db
    .collection<Instance>('instances')
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
}

/** Strip secrets before sending instance JSON to the browser. */
export function publicInstance(inst: Instance): Omit<Instance, 'telegramBotToken' | 'wakeSecret'> & {
  wakeSecret?: undefined;
  telegramBotToken?: undefined;
  hasWakeSecret?: boolean;
} {
  const { telegramBotToken: _t, wakeSecret: _w, ...rest } = inst as Instance & {
    _id?: unknown;
  };
  const { _id: _drop, ...clean } = rest as Instance & { _id?: unknown };
  return {
    ...(clean as Instance),
    hasWakeSecret: Boolean(_w),
  };
}

export async function getInstance(
  userId: string,
  id: string,
): Promise<Instance | null> {
  const db = await getDb();
  return db.collection<Instance>('instances').findOne({ id, userId });
}

export async function createInstanceRecord(input: {
  userId: string;
  name: string;
  sessionId: string;
  sandboxId?: string;
}): Promise<Instance> {
  const db = await getDb();
  const now = new Date().toISOString();
  const inst: Instance = {
    id: nanoid(10),
    userId: input.userId,
    name: input.name.trim() || 'workspace',
    sessionId: input.sessionId,
    sandboxId: input.sandboxId,
    status: 'running',
    aiConfigured: false,
    telegramConfigured: false,
    plan: 'hosting-4c8g',
    config: {},
    wakeSecret: nanoid(24),
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<Instance>('instances').insertOne(inst);
  return inst;
}

export async function updateInstance(
  userId: string,
  id: string,
  patch: Partial<
    Pick<
      Instance,
      | 'status'
      | 'sandboxId'
      | 'aiConfigured'
      | 'telegramConfigured'
      | 'lastError'
      | 'name'
      | 'config'
      | 'wakeSecret'
      | 'telegramBotToken'
    >
  >,
): Promise<Instance | null> {
  const db = await getDb();
  const prev = await getInstance(userId, id);
  if (!prev) return null;
  const next: Instance = {
    ...prev,
    ...patch,
    config:
      patch.config !== undefined ? { ...prev.config, ...patch.config } : prev.config,
    updatedAt: new Date().toISOString(),
  };
  // strip Mongo _id if present from findOne
  const { _id: _drop, ...clean } = next as Instance & { _id?: unknown };
  await db.collection('instances').updateOne({ id, userId }, { $set: clean });
  return clean as Instance;
}

export async function deleteInstance(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.collection('instances').deleteOne({ id, userId });
  return r.deletedCount > 0;
}

/** Public webhook lookup (no user session). */
export async function getInstanceByWake(
  id: string,
  wakeSecret: string,
): Promise<Instance | null> {
  const db = await getDb();
  return db.collection<Instance>('instances').findOne({ id, wakeSecret });
}

export async function ensureWakeSecret(userId: string, id: string): Promise<string> {
  const inst = await getInstance(userId, id);
  if (!inst) throw new Error('Instance not found');
  if (inst.wakeSecret) return inst.wakeSecret;
  const wakeSecret = nanoid(24);
  await updateInstance(userId, id, { wakeSecret });
  return wakeSecret;
}
