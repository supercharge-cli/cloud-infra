export function runtimeHasWork(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  const data = status as { turn?: { busy?: unknown }; backgroundTasks?: unknown };
  if (data.turn?.busy === true) return true;
  return Array.isArray(data.backgroundTasks) && data.backgroundTasks.some((task: unknown) =>
    task !== null && typeof task === "object" && (task as { status?: unknown }).status === "running",
  );
}
