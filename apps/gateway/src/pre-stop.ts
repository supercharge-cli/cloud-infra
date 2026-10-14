// The lifecycle broker is served only on the E2B daemon's owner-only Unix socket.
const PRE_STOP_COMMAND = "curl --silent --show-error --fail --max-time 5 --unix-socket /home/user/.superagent/lifecycle/pre-stop.sock -H 'Content-Type: application/json' --data '{\"v\":1,\"reason\":\"terminate\",\"disk\":\"discarded\",\"deadline_ms\":4000}' http://localhost/lifecycle/pre-stop";
const PRE_STOP_TIMEOUT_MS = 7_000;

type SandboxControl = {
  commands?: {
    run: (command: string, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  kill?: () => Promise<void>;
  close?: () => Promise<void>;
};

export async function invokePreStop(
  sandbox: SandboxControl,
  runtime: string,
  onFailure: (message: string) => void = () => {},
  timeoutMs = PRE_STOP_TIMEOUT_MS,
): Promise<void> {
  if (runtime !== 'supercharge') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!sandbox.commands?.run) throw new Error('E2B command control is unavailable');
    const result = await Promise.race([
      sandbox.commands.run(PRE_STOP_COMMAND, { timeoutMs: 6_000 }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('pre-stop timed out')), timeoutMs);
      }),
    ]);
    if (result.exitCode !== 0) throw new Error(`pre-stop command exited ${String(result.exitCode)}`);
    const response = JSON.parse(String(result.stdout || '')) as { v?: number; verdict?: string };
    if (response.v !== 1 || !['ok', 'no_handlers', 'partial', 'failed', 'timed_out'].includes(response.verdict || '')) {
      throw new Error('invalid pre-stop response');
    }
    if (response.verdict === 'partial' || response.verdict === 'failed' || response.verdict === 'timed_out') {
      onFailure(`pre-stop handlers ${response.verdict}`);
    }
  } catch (error) {
    onFailure(`pre-stop failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function prepareMigration<T>(
  sandbox: SandboxControl,
  runtime: string,
  pack: () => Promise<T>,
  onFailure: (message: string) => void = () => {},
  timeoutMs = PRE_STOP_TIMEOUT_MS,
): Promise<T> {
  await invokePreStop(sandbox, runtime, onFailure, timeoutMs);
  return pack();
}

export async function killWithPreStop(
  sandbox: SandboxControl,
  runtime: string,
  onFailure: (message: string) => void = () => {},
  timeoutMs = PRE_STOP_TIMEOUT_MS,
): Promise<void> {
  if (!sandbox.kill) throw new Error('E2B provider kill is unavailable');
  try {
    await invokePreStop(sandbox, runtime, onFailure, timeoutMs);
  } finally {
    await sandbox.kill();
  }
}

export async function deleteAfterKill(
  sandbox: SandboxControl,
  runtime: string,
  forget: () => Promise<void> | void,
  onFailure: (message: string) => void = () => {},
): Promise<void> {
  await killWithPreStop(sandbox, runtime, onFailure);
  await forget();
  try {
    await sandbox.close?.();
  } catch {
    // The provider kill already succeeded.
  }
}
