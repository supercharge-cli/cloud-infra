/**
 * Guards for Telegram wake webhooks.
 *
 * Without these, a slow wake (sandbox resume can take 30–90s) causes Telegram to
 * redeliver the same update, and each attempt spams the user with
 * "Could not fully wake…".
 */
import { getDb } from './mongodb';

const LOCK_TTL_MS = 90_000;
const NOTIFY_COOLDOWN_MS = 3 * 60_000;
const UPDATE_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

type WakeGuardDoc = {
  _id: string;
  /** ISO — lock held until this time */
  lockUntil?: string;
  /** Random token proving which caller owns the lock */
  lockToken?: string;
  /** ISO — last user-facing wake failure message */
  lastFailNotifyAt?: string;
  /** ISO — last success notify */
  lastOkNotifyAt?: string;
  /** Last Telegram update_id we accepted for processing */
  lastUpdateId?: number;
  recentUpdateIds?: number[];
  expireHint?: string;
  updatedAt: string;
};

async function guards() {
  return (await getDb()).collection<WakeGuardDoc>('telegram_wake_guards');
}

/**
 * Atomic acquire that works under concurrent upsert races.
 * Returns true only if this caller set the lock.
 */
export async function acquireWakeLock(instanceId: string): Promise<boolean> {
  const col = await guards();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const lockUntil = new Date(now + LOCK_TTL_MS).toISOString();
  const token = `${now}-${Math.random().toString(36).slice(2, 10)}`;

  // Ensure doc exists
  await col.updateOne(
    { _id: instanceId },
    { $setOnInsert: { _id: instanceId, updatedAt: nowIso } },
    { upsert: true },
  );

  const r = await col.findOneAndUpdate(
    {
      _id: instanceId,
      $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lte: nowIso } }],
    },
    {
      $set: {
        lockUntil,
        lockToken: token,
        updatedAt: nowIso,
      },
    },
    { returnDocument: 'after' },
  );

  return Boolean(r && (r as WakeGuardDoc & { lockToken?: string }).lockToken === token);
}

export async function releaseWakeLock(instanceId: string): Promise<void> {
  const col = await guards();
  await col.updateOne(
    { _id: instanceId },
    {
      $unset: { lockUntil: '', lockToken: '' },
      $set: { updatedAt: new Date().toISOString() },
    },
  );
}

/** true if we should send a failure message (cooldown elapsed). */
export async function shouldNotifyFail(instanceId: string): Promise<boolean> {
  const col = await guards();
  const doc = await col.findOne({ _id: instanceId });
  if (!doc?.lastFailNotifyAt) return true;
  return Date.now() - new Date(doc.lastFailNotifyAt).getTime() >= NOTIFY_COOLDOWN_MS;
}

export async function markFailNotified(instanceId: string): Promise<void> {
  const col = await guards();
  const nowIso = new Date().toISOString();
  await col.updateOne(
    { _id: instanceId },
    { $set: { lastFailNotifyAt: nowIso, updatedAt: nowIso }, $setOnInsert: { _id: instanceId } },
    { upsert: true },
  );
}

export async function shouldNotifyOk(instanceId: string): Promise<boolean> {
  const col = await guards();
  const doc = await col.findOne({ _id: instanceId });
  if (!doc?.lastOkNotifyAt) return true;
  // Avoid double "awake" if Telegram delivered two updates that both woke successfully
  return Date.now() - new Date(doc.lastOkNotifyAt).getTime() >= 30_000;
}

export async function markOkNotified(instanceId: string): Promise<void> {
  const col = await guards();
  const nowIso = new Date().toISOString();
  await col.updateOne(
    { _id: instanceId },
    { $set: { lastOkNotifyAt: nowIso, updatedAt: nowIso }, $setOnInsert: { _id: instanceId } },
    { upsert: true },
  );
}

/**
 * Dedup Telegram update_id. Returns true if this update was already accepted
 * (caller should ack 200 and skip work).
 */
export async function isDuplicateUpdate(
  instanceId: string,
  updateId: number | undefined,
): Promise<boolean> {
  if (updateId == null || !Number.isFinite(updateId)) return false;
  const col = await guards();
  const doc = await col.findOne({ _id: instanceId });
  if (doc?.lastUpdateId != null && updateId <= doc.lastUpdateId) {
    // Same or older update — treat as duplicate (Telegram redelivery)
    return true;
  }
  // Also check recent processed set for out-of-order redelivery
  const recent = (doc as WakeGuardDoc & { recentUpdateIds?: number[] })?.recentUpdateIds;
  if (recent?.includes(updateId)) return true;
  return false;
}

export async function markUpdateProcessed(
  instanceId: string,
  updateId: number | undefined,
): Promise<void> {
  if (updateId == null || !Number.isFinite(updateId)) return;
  const col = await guards();
  const nowIso = new Date().toISOString();
  const doc = await col.findOne({ _id: instanceId });
  const prev = (doc as WakeGuardDoc & { recentUpdateIds?: number[] })?.recentUpdateIds || [];
  const recent = [...prev.filter((id) => id !== updateId), updateId].slice(-40);
  const lastUpdateId = Math.max(doc?.lastUpdateId ?? 0, updateId);
  await col.updateOne(
    { _id: instanceId },
    {
      $set: {
        lastUpdateId,
        recentUpdateIds: recent,
        updatedAt: nowIso,
        // keep collection from growing forever; logical TTL via updatedAt scans if needed
        expireHint: new Date(Date.now() + UPDATE_DEDUP_TTL_MS).toISOString(),
      },
      $setOnInsert: { _id: instanceId },
    },
    { upsert: true },
  );
}
