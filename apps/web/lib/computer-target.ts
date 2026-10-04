export function computerBotId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return 'main';
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

export function computerBotQuery(botId: string): string {
  return `botId=${encodeURIComponent(botId)}`;
}

export function matchesComputerBot(status: unknown, botId: string): boolean {
  if (botId === 'main') return true;
  if (!status || typeof status !== 'object') return false;
  const value = status as { botId?: unknown; desktop?: { botId?: unknown } };
  return value.botId === botId || value.desktop?.botId === botId;
}
