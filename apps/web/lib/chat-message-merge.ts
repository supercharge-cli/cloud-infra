export type OptimisticMessage = { id: string; text: string; senderBotId?: string | null; pending?: boolean; baseline?: number };

/** Retain local sends until the server confirms them, even during polling. */
export function mergePendingMessages<T extends OptimisticMessage>(remote: T[], previous: T[], group: boolean): T[] {
  const remaining = previous.filter((row) => {
    if (!row.pending) return false;
    if (group) return !remote.some((item) => item.id === row.id);
    const count = remote.filter((item) => !item.senderBotId && item.text === row.text).length;
    return count <= (row.baseline ?? 0);
  });
  return [...remote, ...remaining];
}
