import { mkdir, open, readFile, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type LifecycleRecord = {
  sandboxId: string;
  sessionId: string;
  runtime: 'supercharge' | 'xibecode';
  workspaceRoot: string;
  runStartedAt: number;
  cycleCount: number;
  phase: 'running' | 'draining' | 'paused' | 'resuming';
  updatedAt: number;
  error?: string;
};

export class LifecycleStore {
  constructor(readonly directory: string) {}

  private path(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid sandbox identity');
    return join(this.directory, `${id}.json`);
  }

  async read(id: string): Promise<LifecycleRecord | null> {
    try {
      const record = JSON.parse(await readFile(this.path(id), 'utf8')) as LifecycleRecord;
      if (record.sandboxId !== id || !record.sessionId || !Number.isFinite(record.runStartedAt)) {
        throw new Error('Invalid lifecycle journal');
      }
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async list(): Promise<LifecycleRecord[]> {
    let entries: string[];
    try { entries = await readdir(this.directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records: LifecycleRecord[] = [];
    for (const entry of entries.filter((name) => /^[A-Za-z0-9_-]+\.json$/.test(name))) {
      const record = await this.read(entry.slice(0, -5));
      if (record) records.push(record);
    }
    return records;
  }

  async write(record: LifecycleRecord): Promise<void> {
    const path = this.path(record.sandboxId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(record));
        await file.sync();
      } finally { await file.close(); }
      await rename(temporary, path);
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary, { force: true }); }
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
  }

  // Replicas must share this volume. The lease outlives any single bounded E2B request.
  async withLock<T>(id: string, operation: (assertOwned: () => Promise<void>) => Promise<T>): Promise<{ acquired: boolean; value?: T }> {
    const lock = `${this.path(id)}.lock`;
    const token = randomUUID();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (let attempt = 0; ; attempt++) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const info = await stat(lock).catch(() => null);
        if (attempt > 0 || !info || Date.now() - info.mtimeMs < 10 * 60_000) return { acquired: false };
        const stale = `${lock}.stale-${token}`;
        try { await rename(lock, stale); await rm(stale, { recursive: true, force: true }); }
        catch { return { acquired: false }; }
      }
    }
    const ownerPath = join(lock, 'owner');
    const file = await open(ownerPath, 'wx', 0o600);
    await file.writeFile(token); await file.close();
    const assertOwned = async () => {
      if (await readFile(ownerPath, 'utf8').catch(() => '') !== token) throw new Error('Lifecycle lease lost');
    };
    const heartbeat = setInterval(() => {
      void assertOwned().then(() => utimes(lock, new Date(), new Date())).catch(() => undefined);
    }, 15_000);
    heartbeat.unref?.();
    try { return { acquired: true, value: await operation(assertOwned) }; }
    finally {
      clearInterval(heartbeat);
      if (await readFile(ownerPath, 'utf8').catch(() => '') === token) await rm(lock, { recursive: true, force: true });
    }
  }
}
