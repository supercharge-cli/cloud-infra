import { NextResponse } from 'next/server';
import { requireAgentCaller, syncBots } from '@/lib/bot-service';
import { botJob, BotJobInputError, createBotJob, deliverBotJob, refreshBotJob } from '@/lib/bot-jobs';

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const caller = await requireAgentCaller(req, body);
  if (caller instanceof NextResponse) return caller;
  const { instance, botId, sessionId } = caller;
  if (body.action === 'get' && typeof body.jobId === 'string') {
    const job = await botJob(instance, body.jobId);
    if (!job || !((job.senderBotId === botId && job.senderSessionId === sessionId) ||
        (job.recipientBotId === botId && job.sessionId === sessionId))) {
      return NextResponse.json({ error: 'Task not found in this conversation' }, { status: 404 });
    }
    const current = await refreshBotJob(instance, job);
    return NextResponse.json({ jobId: current.id, botId: current.recipientBotId, status: current.status,
      sessionId: current.sessionId, reply: current.reply, error: current.error });
  }
  if (body.action !== 'send' || typeof body.botId !== 'string') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }
  try {
    const { job } = await createBotJob(instance, body.botId, body.prompt, body.requestId, { botId, sessionId });
    await syncBots(instance);
    await deliverBotJob(instance, job);
    return NextResponse.json({ jobId: job.id, botId: job.recipientBotId,
      sessionId: job.sessionId, status: job.status, resultDelivery: 'automatic', originSessionId: sessionId }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: error instanceof BotJobInputError ? 400 : 502 });
  }
}
