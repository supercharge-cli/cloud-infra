import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getDb } from './mongodb';

export type TokenChatMessage = {
  _id: string; instanceId: string; userId: string; sessionId: string; source: 'cli' | 'mcp';
  ciphertext: string; nonce: string; tag: string; createdAt: Date; messageIndex: number;
};

function key(instanceId: string): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 24) throw new Error('Token chat encryption is unavailable');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from(instanceId), Buffer.from('vectra-github-token-chat-v1'), 32));
}

export function sealToken(instanceId: string, text: string): Pick<TokenChatMessage, 'ciphertext' | 'nonce' | 'tag'> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(instanceId), nonce);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function openToken(instanceId: string, row: Pick<TokenChatMessage, 'ciphertext' | 'nonce' | 'tag'>): string {
  const decipher = createDecipheriv('aes-256-gcm', key(instanceId), Buffer.from(row.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export async function saveTokenMessage(input: Omit<TokenChatMessage, 'ciphertext' | 'nonce' | 'tag' | 'createdAt'>, token: string): Promise<string> {
  const encrypted = sealToken(input.instanceId, token);
  const row = await (await getDb()).collection<TokenChatMessage>('github_token_chat').findOneAndUpdate(
    { _id: input._id, instanceId: input.instanceId, userId: input.userId, source: input.source },
    { $setOnInsert: { ...input, ...encrypted, createdAt: new Date() } }, { upsert: true, returnDocument: 'after' },
  );
  if (!row) throw new Error('Token message could not be saved');
  return openToken(input.instanceId, row);
}

export async function tokenMessages(instanceId: string, userId: string, sessionId: string): Promise<Array<{ id: string; role: 'assistant'; content: string; sensitive: true; messageIndex: number }>> {
  const rows = await (await getDb()).collection<TokenChatMessage>('github_token_chat')
    .find({ instanceId, userId, sessionId }).sort({ createdAt: 1 }).limit(50).toArray();
  return rows.map((row) => {
    let content = 'Stored GitHub token cannot be decrypted after the authentication secret changed. Reconnect GitHub and request it again.';
    try { content = `GitHub ${row.source === 'cli' ? 'CLI' : 'MCP'} token (requested by the owner): ${openToken(instanceId, row)}`; }
    catch { /* A rotated gateway key must not block the rest of the conversation. */ }
    return { id: row._id, role: 'assistant' as const, content, sensitive: true as const, messageIndex: row.messageIndex };
  });
}
