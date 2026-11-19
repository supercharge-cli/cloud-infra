import { nanoid } from "nanoid";
import { getDb } from "./mongodb";
import { hashPassword, verifyPassword } from "./auth";
import type { InstanceBillingStatus, SubscriptionStatus } from "./subscription-core";

export type UserRole = "admin" | "user";

export type UserPollinations = {
  accessToken: string;
  connectedAt: string;
  expiresAt?: string;
  username?: string;
  name?: string;
  email?: string;
  picture?: string;
};

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  role?: UserRole;
  createdAt: string;
  pollinations?: UserPollinations;
};

/** Public user shape (no password hash). */
export type PublicUser = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
};

export function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    role: resolveUserRole(u),
    createdAt: u.createdAt,
  };
}

/** Emails in ADMIN_EMAILS env are always treated as admin (comma-separated). */
export function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

export function resolveUserRole(user: Pick<User, "email" | "role">): UserRole {
  if (user.role === "admin") return "admin";
  if (isAdminEmail(user.email)) return "admin";
  return user.role === "user" ? "user" : "user";
}

export function isAdminUser(
  user: Pick<User, "email" | "role"> | null | undefined,
): boolean {
  if (!user) return false;
  return resolveUserRole(user) === "admin";
}

export type InstanceStatus =
  "creating" | "running" | "paused" | "error" | "destroyed";
export type AgentRuntime = "xibecode" | "supercharge";

export type InstanceConfigMeta = {
  runtime?: AgentRuntime;
  provider?: string;
  model?: string;
  baseUrl?: string;
  hasApiKey?: boolean;
  hasTelegramToken?: boolean;
  hasDiscordToken?: boolean;
  hasSlackToken?: boolean;
  imageProvider?: string;
  imageModel?: string;
  imageBaseUrl?: string;
  imageFormat?: string;
  hasImageApiKey?: boolean;
};

export type Instance = {
  id: string;
  userId: string;
  name: string;
  runtime: AgentRuntime;
  /** E2B template alias used at create (auto-selected from runtime). */
  e2bTemplate?: string;
  /** Inbox port inside the sandbox (Supercharge daemon). */
  daemonPort?: number;
  sessionId: string;
  sandboxId?: string;
  botCapability?: string;
  status: InstanceStatus;
  aiConfigured: boolean;
  telegramConfigured: boolean;
  plan: string;
  config?: InstanceConfigMeta;
  /** Random secret in Telegram webhook URL — host fallback wake (legacy long-poll path). */
  wakeSecret?: string;
  /**
   * Bot token for host-side setWebhook re-registration / sandbox webhook setup.
   */
  telegramBotToken?: string;
  /**
   * Prefer sandbox public URL webhook (E2B auto-resume).
   * `sandbox` = Telegram → https://8788-{sandboxId}.e2b.app/telegram
   * `host` = legacy Vercel arm-on-pause + long-poll
   */
  telegramWebhookMode?: "sandbox" | "host";
  /** Public HTTPS webhook URL on the sandbox (when mode=sandbox). */
  sandboxTelegramWebhookUrl?: string;
  /** Telegram secret_token for sandbox webhook. */
  telegramWebhookSecret?: string;
  /**
   * Free-tier sandbox (one per user by default). Never expires; does not require payment.
   * Additional instances are paid via Razorpay.
   */
  isFree?: boolean;
  /** ISO — access valid until this time (see BILLING_* env for price/period). Ignored when isFree. */
  paidUntil?: string;
  billingStatus?: InstanceBillingStatus;
  /** Razorpay autopay (sub_…) managing this workspace */
  subscriptionId?: string | null;
  subscriptionStatus?: SubscriptionStatus | null;
  nextChargeAt?: string | null;
  cancelAtCycleEnd?: boolean | null;
  pendingPlanId?: string | null;
  /** Failed renewal: access continues until this time */
  graceUntil?: string | null;
  /** Billing paused the sandbox (data kept until retainUntil) */
  billingSuspendedAt?: string | null;
  retainUntil?: string | null;
  /** Retention ended; an operator may delete. Nothing deletes automatically. */
  deletionFlaggedAt?: string | null;
  wasFree?: boolean | null;
  lastPaymentId?: string;
  lastOrderId?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export type PendingOrder = {
  id: string;
  userId: string;
  email: string;
  purpose: "new_instance" | "renew";
  instanceId?: string;
  instanceName: string;
  runtime?: AgentRuntime;
  planId?: string;
  razorpayOrderId: string;
  amountCents: number;
  currency: string;
  status: "created" | "paid" | "failed";
  createdAt: string;
  paidAt?: string;
  paymentId?: string;
};

/**
 * Ensure admins from env exist.
 * - ADMIN_EMAILS=a@x.com,b@y.com
 * - ADMIN_BOOTSTRAP_PASSWORD=... (min 8 chars)
 * When password is set, creates missing admins and syncs their password hash
 * so Vercel env stays the source of truth after DB wipes.
 * Pass the Db from getDb() to avoid circular imports.
 */
export async function ensureBootstrapAdmins(database: {
  collection: (name: string) => {
    findOne: (q: object) => Promise<User | null>;
    insertOne: (doc: User) => Promise<unknown>;
    updateOne: (q: object, u: object) => Promise<unknown>;
  };
}): Promise<void> {
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() || "";
  if (password.length < 8) return;

  const emails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  if (!emails.length) return;

  for (const email of emails) {
    const existing = await database.collection("users").findOne({ email });
    const passwordHash = hashPassword(password);
    if (!existing) {
      const user: User = {
        id: nanoid(12),
        email,
        passwordHash,
        role: "admin",
        createdAt: new Date().toISOString(),
      };
      await database.collection("users").insertOne(user);
      console.log(`[bootstrap] created admin ${email}`);
    } else {
      await database
        .collection("users")
        .updateOne({ email }, { $set: { passwordHash, role: "admin" } });
      console.log(`[bootstrap] synced admin password/role ${email}`);
    }
  }
}

export async function createUser(
  email: string,
  password: string,
  opts?: { role?: UserRole },
): Promise<User> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new Error("Valid email is required");
  }
  if (password.length < 8)
    throw new Error("Password must be at least 8 characters");

  const existing = await db
    .collection<User>("users")
    .findOne({ email: normalized });
  if (existing) throw new Error("Email already registered");

  const role: UserRole =
    opts?.role === "admin" || isAdminEmail(normalized) ? "admin" : "user";

  const user: User = {
    id: nanoid(12),
    email: normalized,
    passwordHash: hashPassword(password),
    role,
    createdAt: new Date().toISOString(),
  };
  await db.collection<User>("users").insertOne(user);
  return user;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  return db
    .collection<User>("users")
    .findOne({ email: email.trim().toLowerCase() });
}

export async function findUserById(id: string): Promise<User | null> {
  const db = await getDb();
  return db.collection<User>("users").findOne({ id });
}

export async function setUserPollinations(
  userId: string,
  pollinations: UserPollinations | null,
): Promise<User | null> {
  const db = await getDb();
  if (pollinations) {
    await db
      .collection<User>("users")
      .updateOne({ id: userId }, { $set: { pollinations } });
  } else {
    await db
      .collection<User>("users")
      .updateOne({ id: userId }, { $unset: { pollinations: "" } });
  }
  return findUserById(userId);
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function listAllUsers(): Promise<PublicUser[]> {
  const db = await getDb();
  const rows = await db
    .collection<User>("users")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  return rows.map(publicUser);
}

export async function setUserRole(
  userId: string,
  role: UserRole,
): Promise<PublicUser | null> {
  const db = await getDb();
  const user = await findUserById(userId);
  if (!user) return null;
  await db.collection("users").updateOne({ id: userId }, { $set: { role } });
  return publicUser({ ...user, role });
}

/** Permanently remove user row. Call after handling their instances. */
export async function deleteUserById(userId: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.collection("users").deleteOne({ id: userId });
  if (r.deletedCount) {
    await Promise.all([
      db.collection('bots').deleteMany({ userId }),
      db.collection('bot_jobs').deleteMany({ userId }),
      db.collection('bot_avatars').deleteMany({ userId }),
    ]);
  }
  return r.deletedCount > 0;
}

export async function countInstancesForUser(userId: string): Promise<number> {
  const db = await getDb();
  return db.collection("instances").countDocuments({
    userId,
    status: { $ne: "destroyed" },
  });
}

/** Non-destroyed free-tier instances for this user (for free quota). */
export async function countFreeInstancesForUser(
  userId: string,
): Promise<number> {
  const db = await getDb();
  return db.collection("instances").countDocuments({
    userId,
    isFree: true,
    status: { $ne: "destroyed" },
  });
}

export async function listInstancesForUser(
  userId: string,
): Promise<Instance[]> {
  const db = await getDb();
  return db
    .collection<Instance>("instances")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();
}

/** Hard-delete instance document from Mongo (after sandbox destroyed). */
export async function hardDeleteInstance(id: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.collection("instances").deleteOne({ id });
  if (r.deletedCount) {
    await Promise.all([
      db.collection('bots').deleteMany({ instanceId: id }),
      db.collection('bot_jobs').deleteMany({ instanceId: id }),
      db.collection('bot_avatars').deleteMany({ instanceId: id }),
    ]);
  }
  return r.deletedCount > 0;
}

export async function reassignInstance(
  instanceId: string,
  newUserId: string,
): Promise<Instance | null> {
  const db = await getDb();
  const prev = await getInstanceById(instanceId);
  if (!prev) return null;
  const owner = await findUserById(newUserId);
  if (!owner) throw new Error("Target user not found");
  const next: Instance = {
    ...prev,
    userId: newUserId,
    ...(prev.runtime === "supercharge" ? { botCapability: nanoid(48) } : {}),
    updatedAt: new Date().toISOString(),
  };
  const { _id: _drop, ...clean } = next as Instance & { _id?: unknown };
  await db
    .collection("instances")
    .updateOne({ id: instanceId }, { $set: clean });
  await Promise.all([
    db.collection('bots').updateMany({ instanceId }, { $set: { userId: newUserId } }),
    db.collection('bot_jobs').updateMany({ instanceId }, { $set: { userId: newUserId } }),
    db.collection('bot_avatars').updateMany({ instanceId }, { $set: { userId: newUserId } }),
  ]);
  return clean as Instance;
}

export async function deleteOrdersForUser(userId: string): Promise<number> {
  const db = await getDb();
  const r = await db.collection("orders").deleteMany({ userId });
  return r.deletedCount || 0;
}

export async function listAllInstances(opts?: {
  includeDestroyed?: boolean;
  limit?: number;
}): Promise<Instance[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = {};
  if (!opts?.includeDestroyed) {
    filter.status = { $ne: "destroyed" };
  }
  return db
    .collection<Instance>("instances")
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(opts?.limit ?? 500)
    .toArray();
}

export async function getInstanceById(id: string): Promise<Instance | null> {
  const db = await getDb();
  return db.collection<Instance>("instances").findOne({ id });
}

export async function adminUpdateInstance(
  id: string,
  patch: Partial<
    Pick<
      Instance,
      "status" | "paidUntil" | "billingStatus" | "lastError" | "name"
    >
  >,
): Promise<Instance | null> {
  const db = await getDb();
  const prev = await getInstanceById(id);
  if (!prev) return null;
  const next: Instance = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const { _id: _drop, ...clean } = next as Instance & { _id?: unknown };
  await db.collection("instances").updateOne({ id }, { $set: clean });
  return clean as Instance;
}

export async function listRecentOrders(limit = 100): Promise<PendingOrder[]> {
  const db = await getDb();
  return db
    .collection<PendingOrder>("orders")
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function adminStats(): Promise<{
  users: number;
  admins: number;
  instances: number;
  running: number;
  paused: number;
  paidActive: number;
  ordersPaid: number;
  ordersTotal: number;
}> {
  const db = await getDb();
  const now = new Date().toISOString();
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const empty = {
    users: 0,
    admins: 0,
    instances: 0,
    running: 0,
    paused: 0,
    paidActive: 0,
    ordersPaid: 0,
    ordersTotal: 0,
  };
  // One round trip. The previous version issued eight commands and loaded
  // every user document; each command costs a full remote round trip.
  const [row] = await db.collection("users").aggregate<{
    users: number;
    admins: number;
    instances: number;
    running: number;
    paused: number;
    paidActive: number;
    ordersPaid: number;
    ordersTotal: number;
  }>([
    {
      $project: {
        _id: 0,
        kind: { $literal: "user" },
        role: 1,
        email: { $toLower: "$email" },
      },
    },
    {
      $unionWith: {
        coll: "instances",
        pipeline: [
          {
            $project: {
              _id: 0,
              kind: { $literal: "instance" },
              status: 1,
              paidUntil: 1,
            },
          },
        ],
      },
    },
    {
      $unionWith: {
        coll: "orders",
        pipeline: [
          { $project: { _id: 0, kind: { $literal: "order" }, status: 1 } },
        ],
      },
    },
    {
      $group: {
        _id: null,
        users: { $sum: { $cond: [{ $eq: ["$kind", "user"] }, 1, 0] } },
        admins: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$kind", "user"] },
                  {
                    $or: [
                      { $eq: ["$role", "admin"] },
                      { $in: ["$email", adminEmails] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        instances: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$kind", "instance"] },
                  { $ne: ["$status", "destroyed"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        running: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$kind", "instance"] },
                  { $eq: ["$status", "running"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        paused: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$kind", "instance"] },
                  { $eq: ["$status", "paused"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        paidActive: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$kind", "instance"] },
                  { $ne: ["$status", "destroyed"] },
                  { $gt: ["$paidUntil", now] },
                ],
              },
              1,
              0,
            ],
          },
        },
        ordersPaid: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$kind", "order"] },
                  { $eq: ["$status", "paid"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        ordersTotal: {
          $sum: { $cond: [{ $eq: ["$kind", "order"] }, 1, 0] },
        },
      },
    },
  ]).toArray();
  if (!row) return empty;
  const { _id: _drop, ...stats } = row as typeof empty & { _id?: unknown };
  return stats;
}

export async function listInstances(
  userId: string,
  opts?: { includeDestroyed?: boolean },
): Promise<Instance[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = { userId };
  // Paused/running/error always listed so the owner can resume. Destroyed hidden by default.
  if (!opts?.includeDestroyed) {
    filter.status = { $ne: "destroyed" };
  }
  return db
    .collection<Instance>("instances")
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
}

/** Strip secrets before sending instance JSON to the browser. */
export function publicInstance(inst: Instance): Omit<
  Instance,
  "telegramBotToken" | "wakeSecret" | "telegramWebhookSecret" | "botCapability"
> & {
  hasWakeSecret?: boolean;
  hasTelegramWebhookSecret?: boolean;
} {
  const {
    telegramBotToken: _t,
    wakeSecret: _w,
    telegramWebhookSecret: _s,
    botCapability: _bot,
    _id: _drop,
    ...rest
  } = inst as Instance & {
    _id?: unknown;
  };
  return {
    ...rest,
    hasWakeSecret: Boolean(_w),
    hasTelegramWebhookSecret: Boolean(_s),
  };
}

export async function getInstance(
  userId: string,
  id: string,
): Promise<Instance | null> {
  const db = await getDb();
  return db.collection<Instance>("instances").findOne({ id, userId });
}

export async function ensureBotCapability(instance: Instance): Promise<string> {
  if (instance.botCapability) return instance.botCapability;
  const db = await getDb();
  const candidate = nanoid(48);
  await db.collection<Instance>('instances').updateOne(
    { id: instance.id, userId: instance.userId, botCapability: { $exists: false } },
    { $set: { botCapability: candidate } },
  );
  const stored = await getInstance(instance.userId, instance.id);
  if (!stored?.botCapability) throw new Error('Bot capability is unavailable');
  return stored.botCapability;
}

export async function createInstanceRecord(input: {
  userId: string;
  name: string;
  sessionId: string;
  sandboxId?: string;
  runtime?: AgentRuntime;
  plan?: string;
  isFree?: boolean;
  paidUntil?: string;
  billingStatus?: Instance["billingStatus"];
}): Promise<Instance> {
  const db = await getDb();
  const now = new Date().toISOString();
  const inst: Instance = {
    id: nanoid(10),
    userId: input.userId,
    name: input.name.trim() || "workspace",
    sessionId: input.sessionId,
    sandboxId: input.sandboxId,
    ...(input.runtime === "supercharge" ? { botCapability: nanoid(48) } : {}),
    runtime: input.runtime || "xibecode",
    e2bTemplate:
      input.runtime === "supercharge"
        ? process.env.SUPERCHARGE_E2B_TEMPLATE?.trim() ||
          "supercharge-daemon-sandbox"
        : process.env.XIBECODE_E2B_TEMPLATE?.trim() || "xibecode-full-sandbox",
    daemonPort: input.runtime === "supercharge" ? 8790 : undefined,
    status: "running",
    aiConfigured: false,
    telegramConfigured: false,
    plan: input.plan || "hosting-2c4g",
    config: {},
    wakeSecret: nanoid(24),
    ...(input.isFree
      ? { isFree: true, billingStatus: "active" as const }
      : {
          ...(input.paidUntil ? { paidUntil: input.paidUntil } : {}),
          ...(input.billingStatus
            ? { billingStatus: input.billingStatus }
            : {}),
        }),
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<Instance>("instances").insertOne(inst);
  return inst;
}

export async function updateInstance(
  userId: string,
  id: string,
  patch: Partial<
    Pick<
      Instance,
      | "status"
      | "sandboxId"
      | "runtime"
      | "aiConfigured"
      | "telegramConfigured"
      | "lastError"
      | "name"
      | "config"
      | "wakeSecret"
      | "telegramBotToken"
      | "telegramWebhookMode"
      | "sandboxTelegramWebhookUrl"
      | "telegramWebhookSecret"
      | "paidUntil"
      | "billingStatus"
      | "isFree"
      | "lastPaymentId"
      | "lastOrderId"
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
      patch.config !== undefined
        ? { ...prev.config, ...patch.config }
        : prev.config,
    updatedAt: new Date().toISOString(),
  };
  // strip Mongo _id if present from findOne
  const { _id: _drop, ...clean } = next as Instance & { _id?: unknown };
  await db.collection("instances").updateOne({ id, userId }, { $set: clean });
  return clean as Instance;
}

export async function deleteInstance(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  const r = await db.collection("instances").deleteOne({ id, userId });
  if (r.deletedCount) {
    await Promise.all([
      db.collection('bots').deleteMany({ instanceId: id }),
      db.collection('bot_jobs').deleteMany({ instanceId: id }),
      db.collection('bot_avatars').deleteMany({ instanceId: id }),
    ]);
  }
  return r.deletedCount > 0;
}

/** Public webhook lookup (no user session). */
export async function getInstanceByWake(
  id: string,
  wakeSecret: string,
): Promise<Instance | null> {
  const db = await getDb();
  return db.collection<Instance>("instances").findOne({ id, wakeSecret });
}

/** Lookup by E2B sandbox id (lifecycle webhooks, ops). */
export async function getInstanceBySandboxId(
  sandboxId: string,
): Promise<Instance | null> {
  const id = (sandboxId || "").trim();
  if (!id) return null;
  const db = await getDb();
  return db.collection<Instance>("instances").findOne({
    sandboxId: id,
    status: { $nin: ["destroyed"] },
  });
}

/**
 * Update status without requiring the owner session (cron / E2B lifecycle).
 * Returns the updated row or null if not found.
 */
export async function updateInstanceById(
  id: string,
  patch: Partial<
    Pick<
      Instance,
      | "status"
      | "lastError"
      | "sandboxId"
      | "telegramBotToken"
      | "wakeSecret"
      | "telegramWebhookMode"
      | "sandboxTelegramWebhookUrl"
      | "telegramWebhookSecret"
    >
  >,
): Promise<Instance | null> {
  const db = await getDb();
  const prev = await db.collection<Instance>("instances").findOne({ id });
  if (!prev) return null;
  const next: Instance = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const { _id: _drop, ...clean } = next as Instance & { _id?: unknown };
  await db.collection("instances").updateOne({ id }, { $set: clean });
  return clean as Instance;
}

export async function ensureWakeSecret(
  userId: string,
  id: string,
): Promise<string> {
  const inst = await getInstance(userId, id);
  if (!inst) throw new Error("Instance not found");
  if (inst.wakeSecret) return inst.wakeSecret;
  const wakeSecret = nanoid(24);
  await updateInstance(userId, id, { wakeSecret });
  return wakeSecret;
}

export async function savePendingOrder(order: PendingOrder): Promise<void> {
  const db = await getDb();
  await db.collection<PendingOrder>("orders").insertOne(order);
}

export async function findPendingOrderByRazorpayId(
  razorpayOrderId: string,
): Promise<PendingOrder | null> {
  const db = await getDb();
  return db.collection<PendingOrder>("orders").findOne({ razorpayOrderId });
}

export async function markOrderPaid(
  razorpayOrderId: string,
  paymentId: string,
): Promise<PendingOrder | null> {
  const db = await getDb();
  const prev = await findPendingOrderByRazorpayId(razorpayOrderId);
  if (!prev) return null;
  if (prev.status === "paid") return prev;
  const next: PendingOrder = {
    ...prev,
    status: "paid",
    paymentId,
    paidAt: new Date().toISOString(),
  };
  const { _id: _drop, ...clean } = next as PendingOrder & { _id?: unknown };
  await db.collection("orders").updateOne({ razorpayOrderId }, { $set: clean });
  return clean as PendingOrder;
}

/** Billing-only patch without an owner session (webhook / cron). null unsets. */
export async function updateInstanceBilling(
  id: string,
  patch: Partial<Instance>,
): Promise<void> {
  const db = await getDb();
  const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const $unset: Record<string, ""> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "_id" || key === "id" || key === "userId") continue;
    if (value === null) $unset[key] = "";
    else if (value !== undefined) $set[key] = value;
  }
  await db.collection("instances").updateOne(
    { id },
    Object.keys($unset).length ? { $set, $unset } : { $set },
  );
}
