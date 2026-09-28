import { randomUUID } from 'node:crypto';
import { Binary } from 'mongodb';
import sharp from 'sharp';
import { getDb } from './mongodb';
import { BotInputError, getBot } from './bots';
import type { Instance } from './store';

export const MAX_BOT_AVATAR_BYTES = 1024 * 1024;
const MAX_IMAGE_SIDE = 2048;
const MAX_IMAGE_PIXELS = 4_194_304;

export type BotAvatar = {
  instanceId: string;
  userId: string;
  botId: string;
  version: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Binary;
  createdAt: Date;
};

export function avatarIcon(version: string): string {
  return `avatar:${version}`;
}

export function avatarVersion(icon: string): string | null {
  const match = /^avatar:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(icon);
  return match?.[1] ?? null;
}

export async function validateBotAvatar(
  data: Buffer,
  mime: string,
  inspect: (bytes: Buffer) => Promise<{ format?: string; width?: number; height?: number }> =
    (bytes) => sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata(),
): Promise<BotAvatar['mime']> {
  const expected = mime === 'image/png' ? 'png' :
    mime === 'image/jpeg' ? 'jpeg' : mime === 'image/webp' ? 'webp' : null;
  if (!expected || data.length < 16 || data.length > MAX_BOT_AVATAR_BYTES) {
    throw new BotInputError('Choose a PNG, JPEG, or WebP picture up to 1 MiB');
  }
  const signature = expected === 'png'
    ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : expected === 'jpeg'
      ? data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  if (!signature) throw new BotInputError('Picture content does not match its format');
  try {
    const image = await inspect(data);
    if (image.format !== expected || !image.width || !image.height ||
        image.width > MAX_IMAGE_SIDE || image.height > MAX_IMAGE_SIDE ||
        image.width * image.height > MAX_IMAGE_PIXELS) {
      throw new BotInputError('Picture dimensions must be at most 2048 × 2048');
    }
  } catch (error) {
    if (error instanceof BotInputError) throw error;
    throw new BotInputError('Could not decode this picture');
  }
  return mime as BotAvatar['mime'];
}

export async function storeBotAvatar(instance: Instance, botId: string, data: Buffer, mime: BotAvatar['mime']): Promise<string> {
  const version = randomUUID();
  const db = await getDb();
  await db.collection<BotAvatar>('bot_avatars').insertOne({
    instanceId: instance.id, userId: instance.userId, botId, version, data: new Binary(data), mime, createdAt: new Date(),
  });
  return version;
}

export async function getBotAvatar(instance: Instance, botId: string, version: string): Promise<BotAvatar | null> {
  if (avatarVersion(avatarIcon(version)) !== version) return null;
  const bot = await getBot(instance, botId);
  if (!bot || bot.icon !== avatarIcon(version)) return null;
  const db = await getDb();
  return db.collection<BotAvatar>('bot_avatars').findOne({
    instanceId: instance.id, userId: instance.userId, botId, version,
  });
}

export async function deleteBotAvatar(instanceId: string, botId: string, version: string): Promise<void> {
  const db = await getDb();
  await db.collection('bot_avatars').deleteOne({ instanceId, botId, version });
}

export async function pruneBotAvatars(instance: Instance, botId: string, keepVersion: string): Promise<void> {
  const db = await getDb();
  await db.collection('bot_avatars').deleteMany({
    instanceId: instance.id, userId: instance.userId, botId,
    version: { $ne: keepVersion },
  });
}
