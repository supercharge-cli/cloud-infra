import { timingSafeEqual } from 'node:crypto';
import { getBot, listBots, exposedBot, type Bot } from './bots';
import { ensureBotCapability, getInstanceById, type Instance } from './store';
import { hasInstanceAccess } from './billing';
import { proxyInbox } from './app-chat';

export function botsEnabled(instance: Instance): boolean {
  return instance.runtime === 'supercharge' && instance.status !== 'destroyed';
}

export async function syncBots(instance: Instance): Promise<void> {
  const bots = await listBots(instance, true);
  const capability = await ensureBotCapability(instance);
  const site = (process.env.PUBLIC_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://infra.xibeai.in').replace(/\/$/, '');
  const base = new URL(site);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('Bot service requires a public HTTPS origin');
  }
  const main = bots.find((bot) => bot.id === 'main');
  for (let start = 0; start < bots.length; start += 32) {
    const batch = bots.slice(start, start + 32);
    if (main && !batch.some((bot) => bot.id === 'main')) batch.unshift(main);
    const response = await proxyInbox(instance, '/v1/app/bots/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: instance.id, capability, site, bots: batch.map(exposedBot) }),
    });
    if (!response.ok) throw new Error(`Bot runtime sync failed (HTTP ${response.status})`);
  }
}

export async function validBot(instance: Instance, id: string): Promise<Bot | null> {
  if (!botsEnabled(instance)) return null;
  return getBot(instance, id);
}

export async function authenticateBotCapability(instanceId: string, secret: string): Promise<Instance | null> {
  if (!instanceId || !secret) return null;
  const instance = await getInstanceById(instanceId);
  if (!instance || !botsEnabled(instance) || !hasInstanceAccess(instance) || !instance.botCapability) return null;
  const expected = Buffer.from(instance.botCapability);
  const supplied = Buffer.from(secret);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return instance;
}
