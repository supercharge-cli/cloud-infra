import type { LifecycleRecord, LifecycleStore } from './lifecycle-store.js';

export const DEFAULT_CYCLE_MS = 23 * 60 * 60 * 1000;
export const HARD_LIMIT_MS = 24 * 60 * 60 * 1000;
export const MIN_CYCLE_MARGIN_MS = 30 * 60 * 1000;

export type SandboxRunInfo = {
  state?: string;
  startedAt?: Date | string;
  cpuCount?: number;
  memoryMB?: number;
};

export function sandboxRunStartedAt(info: SandboxRunInfo): number | null {
  const value = info.startedAt instanceof Date ? info.startedAt.getTime()
    : typeof info.startedAt === 'string' ? Date.parse(info.startedAt) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function cycleRequired(info: SandboxRunInfo, thresholdMs: number, now: number, recordedStart?: number): boolean {
  if (info.state !== 'running' || thresholdMs <= 0) return false;
  const start = recordedStart ?? sandboxRunStartedAt(info);
  return start === null || start <= 0 || start > now || now - start >= thresholdMs;
}

export function cycleThreshold(configured: number): number {
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_CYCLE_MS;
  return Math.max(60_000, Math.min(configured, HARD_LIMIT_MS - MIN_CYCLE_MARGIN_MS));
}

export type CycleDriver = {
  info(): Promise<SandboxRunInfo>;
  pause(): Promise<boolean>;
  connect(): Promise<void>;
  maintenance(action: 'drain' | 'interrupt' | 'resume'): Promise<{ busy?: boolean }>;
  refreshTimeout(): Promise<void>;
};

export async function runContinuousCycle(
  store: LifecycleStore,
  identity: Pick<LifecycleRecord, 'sandboxId' | 'sessionId' | 'runtime' | 'workspaceRoot'>,
  driver: CycleDriver,
  options: { thresholdMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; drainMs?: number } = {},
): Promise<LifecycleRecord | null> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const threshold = options.thresholdMs ?? DEFAULT_CYCLE_MS;
  const locked = await store.withLock(identity.sandboxId, async (assertOwned) => {
    let info = await driver.info();
    let record = await store.read(identity.sandboxId) ?? {
      ...identity, runStartedAt: sandboxRunStartedAt(info) ?? 0, cycleCount: 0,
      phase: 'running' as const, updatedAt: now(),
    };
    const persist = async (patch: Partial<LifecycleRecord>) => {
      await assertOwned();
      record = { ...record, ...patch, updatedAt: now() };
      await store.write(record);
    };
    // A genuine idle pause does not need a wake. Pending maintenance does.
    if (info.state === 'paused' && record.phase === 'running') return null;
    if (info.state !== 'running' && info.state !== 'paused') throw new Error(`Sandbox state unavailable: ${info.state}`);
    if (record.phase === 'running' && !cycleRequired(info, threshold, now(), record.runStartedAt)) return null;
    try {
      if (record.phase === 'running' || record.phase === 'draining') {
        await persist({ phase: 'draining', error: undefined });
        if (info.state === 'running') {
          let draining = await driver.maintenance('drain');
          const deadline = now() + (options.drainMs ?? 20_000);
          for (let attempt = 0; draining.busy && attempt < 20 && now() < deadline; attempt++) {
            await sleep(1000);
            await assertOwned();
            draining = await driver.maintenance('drain');
          }
          if (draining.busy) {
            await assertOwned();
            const interrupted = await driver.maintenance('interrupt');
            if (interrupted.busy) throw new Error('Daemon did not quiesce active turns');
          }
          await assertOwned();
          const acknowledged = await driver.pause();
          if (!acknowledged) {
            info = await driver.info();
            if (info.state !== 'paused') throw new Error('E2B did not acknowledge the pause');
          }
        }
        await persist({ phase: 'paused' });
      }
      if (record.phase === 'paused') {
        // Store a lower bound BEFORE connect; getInfo.startedAt need not change across resumes.
        await persist({ phase: 'resuming', runStartedAt: now() });
      }
      await assertOwned();
      await driver.connect();
      info = await driver.info();
      if (info.state !== 'running') throw new Error(`E2B resume not confirmed: ${info.state}`);
      await driver.refreshTimeout();
      await assertOwned();
      await driver.maintenance('resume');
      await persist({ phase: 'running', cycleCount: record.cycleCount + 1, error: undefined });
      return record;
    } catch (error) {
      await persist({ error: (error as Error).message.slice(0, 500) });
      throw error;
    }
  });
  if (!locked.acquired) return null;
  return locked.value ?? null;
}
