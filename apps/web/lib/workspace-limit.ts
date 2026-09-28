import { randomUUID } from 'node:crypto';
import { getDb } from './mongodb';
import { countInstancesForUser } from './store';

export class WorkspaceLimitError extends Error {
  readonly status = 409;
  constructor(message = 'Your account already has a workspace. Add agents inside it instead of creating another workspace.') { super(message); }
}

export async function requireWorkspaceSlot(userId: string): Promise<void> {
  if (await countInstancesForUser(userId) > 0) throw new WorkspaceLimitError();
}

export async function withWorkspaceCreation<T>(userId: string, create: () => Promise<T>): Promise<T> {
  const db = await getDb();
  const collection = db.collection<{ _id: string; token: string; expiresAt: Date }>('workspace_creation_locks');
  const token = randomUUID();
  const now = new Date();
  try {
    await collection.findOneAndUpdate({ _id: userId, expiresAt: { $lte: now } },
      { $set: { token, expiresAt: new Date(now.getTime() + 10 * 60_000) } }, { upsert: true });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new WorkspaceLimitError('Workspace creation is already in progress. Wait for it to finish, then open Chats.');
    throw error;
  }
  const heartbeat = setInterval(() => {
    void collection.updateOne({ _id: userId, token }, { $set: { expiresAt: new Date(Date.now() + 10 * 60_000) } }).catch(() => undefined);
  }, 60_000);
  heartbeat.unref?.();
  try {
    await requireWorkspaceSlot(userId);
    return await create();
  } finally {
    clearInterval(heartbeat);
    await collection.deleteOne({ _id: userId, token });
  }
}
