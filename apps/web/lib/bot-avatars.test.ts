import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { Binary } from 'mongodb';
import { avatarIcon, avatarVersion, MAX_BOT_AVATAR_BYTES, validateBotAvatar } from './bot-avatars';

const png = async () => sharp({ create: {
  width: 16, height: 16, channels: 4, background: '#24864a',
} }).png().toBuffer();

test('accepts a valid picture at exactly 1 MiB without a large bot icon', async () => {
  const original = await png();
  const padding = Buffer.alloc(MAX_BOT_AVATAR_BYTES - original.length - 12);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(padding.length, 0);
  const type = Buffer.from('avTR');
  const checksum = Buffer.alloc(4);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, padding])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
    }
  }
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  const ancillaryChunk = Buffer.concat([length, type, padding, checksum]);
  const data = Buffer.concat([original.subarray(0, -12), ancillaryChunk, original.subarray(-12)]);
  assert.equal(data.length, MAX_BOT_AVATAR_BYTES);
  assert.deepEqual(new Binary(data).buffer, data);
  assert.equal((await sharp(data).metadata()).format, 'png');
  assert.equal(await validateBotAvatar(data, 'image/png'), 'image/png');
  const reference = avatarIcon('12345678-1234-4123-8123-123456789abc');
  assert.equal(reference.length, 43);
  assert.equal(avatarVersion(reference), '12345678-1234-4123-8123-123456789abc');
});

test('rejects bytes over the limit, mismatched content and oversized dimensions', async () => {
  const original = await png();
  await assert.rejects(validateBotAvatar(Buffer.concat([
    original, Buffer.alloc(MAX_BOT_AVATAR_BYTES + 1 - original.length),
  ]), 'image/png'), /1 MiB/);
  await assert.rejects(validateBotAvatar(original, 'image/webp'), /does not match/);
  await assert.rejects(validateBotAvatar(Buffer.alloc(20), 'image/png'), /does not match/);
  await assert.rejects(validateBotAvatar(original, 'image/png', async () => ({
    format: 'png', width: 3000, height: 16,
  })), /2048/);
  assert.equal(avatarVersion('avatar:../../other-instance'), null);
  await assert.rejects(validateBotAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'image/png'), /does not match/);
});
