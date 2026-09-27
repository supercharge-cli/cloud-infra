export function runtimeHasWork(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  const data = status as { turn?: { busy?: unknown }; backgroundTasks?: unknown; activeBotChats?: unknown; queuedBotChats?: unknown };
  if (data.turn?.busy === true) return true;
  if (Array.isArray(data.activeBotChats) && data.activeBotChats.length > 0) return true;
  if (Array.isArray(data.queuedBotChats) && data.queuedBotChats.length > 0) return true;
  return Array.isArray(data.backgroundTasks) && data.backgroundTasks.some((task: unknown) =>
    task !== null && typeof task === "object" && (task as { status?: unknown }).status === "running",
  );
}
