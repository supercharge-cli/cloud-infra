import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createGatewaySession, getSandboxState } from '@/lib/gateway-client';
import {
  createInstanceRecord,
  listInstances,
  publicInstance,
  updateInstance,
  type Instance,
  type InstanceStatus,
} from '@/lib/store';

function mapE2bToStatus(state: string, prev: InstanceStatus): InstanceStatus {
  if (state === 'paused') return 'paused';
  if (state === 'running') return 'running';
  if (state === 'missing') return 'error';
  return prev;
}

/** List always returns Mongo-owned instances (including paused) so the user can resume. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  const rows = await listInstances(user.id);
  const instances = await Promise.all(
    rows.map(async (inst) => {
      let liveState: string | undefined;
      let resumable = true;
      let liveMessage: string | undefined;

      if (inst.sandboxId && inst.status !== 'destroyed') {
        try {
          const live = await getSandboxState(inst.sandboxId);
          liveState = live.state;
          resumable = live.resumable;
          liveMessage = live.message;

          const nextStatus = mapE2bToStatus(live.state, inst.status);
          if (nextStatus !== inst.status) {
            const updated = await updateInstance(user.id, inst.id, {
              status: nextStatus,
              lastError:
                live.state === 'missing'
                  ? (live.message || 'Sandbox no longer exists on E2B').slice(0, 500)
                  : nextStatus === 'paused'
                    ? undefined
                    : inst.lastError,
            });
            if (updated) Object.assign(inst, updated);
          } else if (live.state === 'paused' && inst.status !== 'paused') {
            await updateInstance(user.id, inst.id, { status: 'paused' });
            inst.status = 'paused';
          }
        } catch {
          // Gateway down — still return Mongo row so UI stays populated
          liveState = 'unknown';
          resumable = true;
        }
      }

      return {
        ...publicInstance(inst as Instance),
        liveState: liveState || inst.status,
        resumable,
        liveMessage,
      };
    }),
  );

  return NextResponse.json({ instances });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name || 'workspace').slice(0, 64);
    const session = await createGatewaySession({ strategy: 'sandbox_full' });
    const instance = await createInstanceRecord({
      userId: user.id,
      name,
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
    });
    return NextResponse.json(
      { instance: publicInstance(instance) },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to provision sandbox: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
