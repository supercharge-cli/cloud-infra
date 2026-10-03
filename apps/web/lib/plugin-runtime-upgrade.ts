import { createGatewaySession, gatewaySessionFetch } from './gateway-client';

export type PluginRuntimeStatus = {
  success: boolean;
  sandboxId: string;
  ready: boolean;
  updated?: boolean;
};

export async function pluginRuntimeStatus(sessionId: string, sandboxId: string): Promise<PluginRuntimeStatus> {
  return requestRuntime(sessionId, sandboxId);
}

export async function upgradePluginRuntime(sessionId: string, sandboxId: string, botId: string): Promise<PluginRuntimeStatus> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId)) throw new Error('Invalid bot');
  return requestRuntime(sessionId, sandboxId, botId);
}

async function requestRuntime(sessionId: string, sandboxId: string, botId?: string): Promise<PluginRuntimeStatus> {
  if (!sessionId || !sandboxId || !/^[A-Za-z0-9_-]{1,128}$/.test(sandboxId)) {
    throw new Error('A current Supercharge sandbox is required');
  }
  // Reattach explicitly before the request. Never retry a mutation on an uncertain response.
  const session = await createGatewaySession({ sessionId, sandboxId, runtime: 'supercharge', strategy: 'sandbox_full' });
  if (session.sandboxId !== sandboxId || session.runtime !== 'supercharge') {
    throw new Error('Supercharge sandbox identity mismatch');
  }
  const response = await gatewaySessionFetch(sessionId, '/plugin-runtime', botId ? {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sandboxId, botId }),
    signal: AbortSignal.timeout(155_000),
  } : { signal: AbortSignal.timeout(45_000) });
  const data = await response.json() as Partial<PluginRuntimeStatus> & { error?: string };
  if (!response.ok || data.success !== true || data.sandboxId !== sandboxId) {
    throw new Error(response.ok ? 'VM runtime identity not confirmed' : (data.error || 'Plugin runtime unavailable'));
  }
  return data as PluginRuntimeStatus;
}
