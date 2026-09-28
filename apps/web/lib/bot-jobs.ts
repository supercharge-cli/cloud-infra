import { nanoid } from 'nanoid';
import { getDb } from './mongodb';
import { getBot, type Bot } from './bots';
import { proxyInbox } from './app-chat';
import type { Instance } from './store';

export type BotJob = {
  id: string;
  instanceId: string;
  userId: string;
  senderBotId: string;
  senderSessionId?: string;
  recipientBotId: string;
  sessionId: string;
  prompt: string;
  requestId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'stopped';
  reply?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export class BotJobInputError extends Error {}

export async function botJob(instance: Instance, jobId: string): Promise<BotJob | null> {
  const db = await getDb();
  return db.collection<BotJob>('bot_jobs').findOne({ instanceId: instance.id, id: jobId });
}

export async function createBotJob(
  instance: Instance, botId: string, prompt: unknown, requestId: unknown,
  sender: { botId: string; sessionId: string },
): Promise<{ bot: Bot; job: BotJob }> {
  const bot = await getBot(instance, botId);
  if (!bot || bot.id === sender.botId) throw new BotJobInputError('Choose a different available agent');
  if (!await getBot(instance, sender.botId) || !/^[A-Za-z0-9_-]{1,128}$/.test(sender.sessionId)) {
    throw new BotJobInputError('Invalid originating agent conversation');
  }
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > 12_000) {
    throw new BotJobInputError('Prompt must be 1–12,000 characters');
  }
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(requestId)) {
    throw new BotJobInputError('Invalid request ID');
  }
  const db = await getDb();
  const collection = db.collection<BotJob>('bot_jobs');
  const existing = await collection.findOne({ instanceId: instance.id, requestId });
  if (existing) {
    if (existing.recipientBotId !== botId || existing.prompt !== prompt.trim() || existing.senderBotId !== sender.botId || existing.senderSessionId !== sender.sessionId) {
      throw new BotJobInputError('Request ID has already been used');
    }
    return { bot, job: existing };
  }
  const id = nanoid(18);
  const now = new Date().toISOString();
  const job: BotJob = {
    id, instanceId: instance.id, userId: instance.userId, senderBotId: sender.botId, senderSessionId: sender.sessionId,
    recipientBotId: botId, sessionId: `bot-${botId}`, prompt: prompt.trim(), requestId,
    status: 'queued', createdAt: now, updatedAt: now,
  };
  try { await collection.insertOne(job); }
  catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const prior = await collection.findOne({ instanceId: instance.id, requestId });
      if (prior && prior.recipientBotId === botId && prior.prompt === prompt.trim() && prior.senderBotId === sender.botId && prior.senderSessionId === sender.sessionId) return { bot, job: prior };
    }
    throw error;
  }
  return { bot, job };
}

export async function deliverBotJob(instance: Instance, job: BotJob): Promise<void> {
  if (job.status !== 'queued') return;
  const res = await proxyInbox(instance, '/v1/app/bot-jobs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, botId: job.recipientBotId,
      chatId: job.sessionId, text: `[Task from ${job.senderBotId} · ${job.id}]\n${job.prompt}`,
      senderBotId: job.senderBotId, senderSessionId: job.senderSessionId }),
  });
  if (!res.ok) {
    const reason = await res.text().catch(() => '');
    throw new Error(`Bot job could not be queued (HTTP ${res.status}): ${reason.slice(0, 150)}`);
  }
}

export async function refreshBotJob(instance: Instance, job: BotJob): Promise<BotJob> {
  if (job.status !== 'queued' && job.status !== 'running') return job;
  try {
    const status = await proxyInbox(instance, `/v1/app/bot-jobs/${encodeURIComponent(job.id)}`);
    if (!status.ok) throw new Error(`Bot job status unavailable (HTTP ${status.status})`);
    const result = await status.json() as { status?: BotJob['status']; reply?: string; error?: string };
    if (!result.status) return job;
    const db = await getDb();
    const updated = await db.collection<BotJob>('bot_jobs').findOneAndUpdate(
      { instanceId: instance.id, id: job.id },
      { $set: { status: result.status, reply: result.reply ?? '', error: result.error ?? '',
        updatedAt: new Date().toISOString() } }, { returnDocument: 'after' },
    );
    return updated ?? job;
  } catch (error) {
    return { ...job, error: `Status could not be refreshed: ${(error as Error).message}` };
  }
}
