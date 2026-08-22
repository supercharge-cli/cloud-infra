import { NextResponse } from "next/server";
import { gatewaySessionFetch } from "@/lib/gateway-client";
import { requireChatInstance } from "@/lib/app-chat";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };
const MAX_PATH_LENGTH = 512;
const MAX_CONTENT_LENGTH = 4 * 1024 * 1024;

function validatePath(raw: unknown): string {
  const path = String(raw || "").trim();
  if (
    !path ||
    path.length > MAX_PATH_LENGTH ||
    path.includes("\0") ||
    path.includes("..")
  ) {
    throw new Error("Invalid workspace file path");
  }
  return path;
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  let path: string;
  try {
    path = validatePath(new URL(req.url).searchParams.get("path"));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
  try {
    const res = await gatewaySessionFetch(
      gate.inst.sessionId,
      `/file?path=${encodeURIComponent(path)}`,
      { headers: { accept: "application/json" } },
      {
        sandboxId: gate.inst.sandboxId,
        runtime: gate.inst.runtime || "xibecode",
      },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 },
    );
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  let body: { path?: string; content?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  let path: string;
  try {
    path = validatePath(body.path);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
  const content = typeof body.content === "string" ? body.content : "";
  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: "File content is too large" },
      { status: 413 },
    );
  }
  try {
    const res = await gatewaySessionFetch(
      gate.inst.sessionId,
      "/file",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ path, content }),
      },
      {
        sandboxId: gate.inst.sandboxId,
        runtime: gate.inst.runtime || "xibecode",
      },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 },
    );
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  let path: string;
  try {
    path = validatePath(new URL(req.url).searchParams.get("path"));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
  try {
    const res = await gatewaySessionFetch(
      gate.inst.sessionId,
      "/file",
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ path }),
      },
      {
        sandboxId: gate.inst.sandboxId,
        runtime: gate.inst.runtime || "xibecode",
      },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 },
    );
  }
}
