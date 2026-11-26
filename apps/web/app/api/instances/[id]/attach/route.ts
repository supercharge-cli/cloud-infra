import { NextResponse } from "next/server";
import { requireChatInstance } from "@/lib/app-chat";
import { startWorkspaceHost, wakeSession } from "@/lib/gateway-client";
import { updateInstance } from "@/lib/store";
import { getSessionUser } from "@/lib/auth";
import { attachWorkspace } from "@/lib/workspace-host";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Open a workspace on this device: wake, start the host, mint a device session. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const user = await getSessionUser();
  const body = (await req.json().catch(() => ({}))) as { device?: unknown };
  try {
    const result = await attachWorkspace(gate.inst, body, {
      wake: (inst) => wakeSession(inst.sessionId, { sandboxId: inst.sandboxId, runtime: "supercharge", restartDaemon: false }),
      startHost: (inst, session, label) => startWorkspaceHost(inst.sessionId, { sandboxId: inst.sandboxId, session, label }),
      markRunning: async (inst) => {
        if (user && inst.status !== "running") await updateInstance(user.id, inst.id, { status: "running", lastError: undefined });
      },
    });
    return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message.slice(0, 300) }, { status: 502 });
  }
}
