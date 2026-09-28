import { nanoid } from 'nanoid';
import { getDb } from './mongodb';
import type { Instance } from './store';

export const MAIN_BOT = 'main';
export const WORKSPACE = '/home/user/workspace';
export const BOT_ICONS = ['🤖', '🔎', '🛠️', '🎨', '📝', '📊', '🧠', '🌐', '⚡', '✨', '💻', '🧪', '🔒'] as const;

export type Bot = {
  id: string;
  userId: string;
  instanceId: string;
  name: string;
  icon: string;
  instructions: string;
  defaultFolder: string;
  creatorBotId?: string;
  revision: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  createKey?: string;
};

export type BotInput = {
  name: string;
  icon?: string;
  instructions?: string;
  defaultFolder?: string;
  createKey?: string;
};

export class BotInputError extends Error {}

export function botName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new BotInputError('Name must be 1–80 printable characters');
  }
  return value.trim();
}

export function botIcon(value: unknown): string {
  if (value === undefined || value === null || value === '') return '🤖';
  if (typeof value === 'string' && BOT_ICONS.includes(value as typeof BOT_ICONS[number])) return value;
  const match = typeof value === 'string'
    ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
    : null;
  if (!match || typeof value !== 'string') throw new BotInputError('Choose a preset icon or a PNG, JPEG, or WebP image');
  const bytes = Buffer.from(match[2], 'base64');
  const headerIsValid = match[1] === 'png'
    ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(16) >= 1 && bytes.readUInt32BE(16) <= 512 &&
      bytes.readUInt32BE(20) >= 1 && bytes.readUInt32BE(20) <= 512
    : match[1] === 'jpeg'
      ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
        bytes.subarray(-2).equals(Buffer.from([255, 217]))
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' &&
        bytes.readUInt32LE(4) + 8 === bytes.length;
  if (bytes.length < 16 || bytes.length > 32 * 1024 || !headerIsValid || bytes.toString('base64') !== match[2]) {
    throw new BotInputError('Image icon is invalid or larger than 32 KB');
  }
  return value;
}

export function botInstructions(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 16_000 || value.includes('\0')) {
    throw new BotInputError('Instructions must be at most 16,000 characters');
  }
  return value.trim();
}

export function botFolder(value: unknown, id: string): string {
  const path = value === undefined || value === null || value === '' ? `${WORKSPACE}/bots/${id}` : value;
  const relative = typeof path === 'string' && path.startsWith(`${WORKSPACE}/`) ? path.slice(WORKSPACE.length + 1) : '';
  if (typeof path !== 'string' || path.length > 256 || !relative || path.includes('\\') ||
      /[\x00-\x1f\x7f]/.test(path) || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new BotInputError('Folder must be an absolute path inside /home/user/workspace');
  }
  return path;
}

export function exposedBot(bot: Bot): Omit<Bot, 'userId' | 'createKey'> {
  const { _id: _id, userId: _userId, createKey: _createKey, ...publicFields } = bot as Bot & { _id?: unknown };
  return publicFields;
}

export async function ensureMainBot(instance: Instance): Promise<Bot> {
  const db = await getDb();
  const now = new Date().toISOString();
  const main: Bot = {
    id: MAIN_BOT, instanceId: instance.id, userId: instance.userId, name: 'Main', icon: '🤖',
    instructions: '', defaultFolder: WORKSPACE, revision: 1, archived: false, createdAt: now, updatedAt: now,
  };
  try {
    await db.collection<Bot>('bots').updateOne(
      { instanceId: instance.id, id: MAIN_BOT }, { $setOnInsert: main }, { upsert: true },
    );
  } catch (error) { if ((error as {code?:number}).code !== 11000) throw error; }
  const result = await db.collection<Bot>('bots').findOne({ instanceId: instance.id, id: MAIN_BOT });
  if (!result) throw new Error('Main bot unavailable');
  return result;
}

export async function listBots(instance: Instance, archived = false): Promise<Bot[]> {
  await ensureMainBot(instance);
  const db = await getDb();
  const rows = await db.collection<Bot>('bots')
    .find({ instanceId: instance.id, ...(archived ? {} : { archived: false }) })
    .sort({ createdAt: 1 }).toArray();
  return rows.sort((a, b) => a.id === MAIN_BOT ? -1 : b.id === MAIN_BOT ? 1 : 0);
}

export async function getBot(instance: Instance, id: string, archived = false): Promise<Bot | null> {
  if (id === MAIN_BOT) return ensureMainBot(instance);
  const db = await getDb();
  return db.collection<Bot>('bots').findOne({ instanceId: instance.id, id, ...(archived ? {} : { archived: false }) });
}

export async function createBot(instance: Instance, input: BotInput, creatorBotId?: string): Promise<Bot> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BotInputError('Invalid bot definition');
  const name = botName(input.name);
  const icon = botIcon(input.icon);
  const instructions = botInstructions(input.instructions);
  const key = input.createKey;
  if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(key))) {
    throw new BotInputError('Invalid create request ID');
  }
  const db = await getDb();
  const collection = db.collection<Bot>('bots');
  if (key) {
    const existing = await collection.findOne({ instanceId: instance.id, createKey: key });
    if (existing) {
      if (existing.name !== name || existing.instructions !== instructions || existing.icon !== icon ||
          input.defaultFolder && existing.defaultFolder !== input.defaultFolder) throw new BotInputError('Create request ID was already used');
      return existing;
    }
  }
  const id = nanoid(16);
  const defaultFolder = botFolder(input.defaultFolder, id);
  const now = new Date().toISOString();
  const bot: Bot = {
    id, instanceId: instance.id, userId: instance.userId, name, icon, instructions, defaultFolder,
    creatorBotId, revision: 1, archived: false, createdAt: now, updatedAt: now,
    ...(key ? { createKey: key } : {}),
  };
  try { await collection.insertOne(bot); }
  catch (error) {
    if (key && (error as { code?: number }).code === 11000) {
      const existing = await collection.findOne({ instanceId: instance.id, createKey: key });
      if (existing) return existing;
    }
    throw error;
  }
  return bot;
}

export async function updateBot(
  instance: Instance, id: string, patch: Partial<BotInput> & { archived?: boolean },
): Promise<Bot | null> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BotInputError('Invalid bot changes');
  const current = await getBot(instance, id, true);
  if (!current) return null;
  if (id === MAIN_BOT && patch.archived === true) throw new BotInputError('Main cannot be archived');
  if (current.archived && patch.archived !== false) throw new BotInputError('Restore the bot before editing');
  if (patch.archived !== undefined && typeof patch.archived !== 'boolean') throw new BotInputError('Invalid archive state');
  const changes: Partial<Bot> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) changes.name = botName(patch.name);
  if (patch.icon !== undefined) {
    if (typeof patch.icon === 'string' && patch.icon.startsWith('avatar:')) {
      if (!/^avatar:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(patch.icon)) {
        throw new BotInputError('Invalid picture reference');
      }
      if (patch.icon !== current.icon) {
        const db = await getDb();
        const exists = await db.collection('bot_avatars').findOne({
          instanceId: instance.id, userId: instance.userId, botId: id,
          version: patch.icon.slice('avatar:'.length),
        });
        if (!exists) throw new BotInputError('Picture was not uploaded for this bot');
      }
      changes.icon = patch.icon;
    } else {
      changes.icon = botIcon(patch.icon);
    }
  }
  if (patch.instructions !== undefined) changes.instructions = botInstructions(patch.instructions);
  if (patch.defaultFolder !== undefined) {
    changes.defaultFolder = id === MAIN_BOT && patch.defaultFolder === WORKSPACE
      ? WORKSPACE : botFolder(patch.defaultFolder, id);
  }
  if (patch.archived !== undefined) changes.archived = patch.archived;
  const db = await getDb();
  const updated = await db.collection<Bot>('bots').findOneAndUpdate(
    { instanceId: instance.id, id, revision: current.revision },
    { $set: changes, $inc: { revision: 1 } }, { returnDocument: 'after' },
  );
  if (!updated) throw new BotInputError('Bot was edited elsewhere; reload and retry');
  return updated;
}
