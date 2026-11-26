import { NextResponse, type NextRequest } from "next/server";
import { corsHeaders } from "@/lib/app-cors";

export function proxy(req: NextRequest) {
  const headers = corsHeaders(req.nextUrl.pathname, req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    // Preflight: answer here; a route handler has no OPTIONS export.
    return headers ? new NextResponse(null, { status: 204, headers }) : new NextResponse(null, { status: 403 });
  }
  const res = NextResponse.next();
  if (headers) for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
  return res;
}

export const config = {
  matcher: ["/api/auth/login", "/api/instances", "/api/instances/:id/:path*"],
};
