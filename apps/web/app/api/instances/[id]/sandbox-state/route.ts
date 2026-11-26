import { NextResponse } from "next/server";
import { requireChatInstance } from "@/lib/app-chat";
import { appInboxFetch } from "@/lib/gateway-client";
import type { Instance } from "@/lib/store";
import { readSandboxState, writeSandboxState, type HostFetch } from "@/lib/workspace-host";

type Ctx = { params: Promise<{ id: string }> };

// Talk to the running host directly; never start the old daemon from here.
function hostFetch(inst: Instance): HostFetch {
  return (path, init) => appInboxFetch(inst.sessionId, path, { ...init, signal: AbortSignal.timeout(15_000) }, { sandboxId: inst.sandboxId, runtime: "supercharge" });
}

function reply(result: { status: number; body: Record<string, unknown> }) {
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  try {
    return reply(await readSandboxState(hostFetch(gate.inst)));
  } catch {
    return reply({ status: 502, body: { error: "Workspace host unreachable" } });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => null);
  try {
    return reply(await writeSandboxState(hostFetch(gate.inst), body));
  } catch {
    return reply({ status: 502, body: { error: "Workspace host unreachable" } });
  }
}
