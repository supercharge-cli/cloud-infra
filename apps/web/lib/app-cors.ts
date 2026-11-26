/**
 * CORS for the computer app: it is a separate page that signs in with a bearer
 * token, so only the API routes it calls answer cross-origin, only for listed
 * origins, and never with credentials (cookies stay same-origin).
 */
const DEV_ORIGINS = ["http://localhost:4173", "http://127.0.0.1:4173"];

const APP_ROUTES = [
  /^\/api\/auth\/login$/,
  /^\/api\/instances$/,
  /^\/api\/instances\/[^/]+\/(wake|attach|preview|sandbox-state)$/,
  /^\/api\/instances\/[^/]+\/computer\/(handoff|vnc-ticket|status)$/,
];

export function appOrigins(env: Record<string, string | undefined> = process.env): Set<string> {
  const listed = (env.VECTRABOT_APP_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter((value) => /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(value));
  return new Set(env.NODE_ENV === "production" && env.VECTRABOT_APP_DEV_ORIGINS !== "1" ? listed : [...listed, ...DEV_ORIGINS]);
}

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.some((pattern) => pattern.test(pathname));
}

/** Headers to add for this request, or null when it is not an allowed cross-origin call. */
export function corsHeaders(pathname: string, origin: string | null, env?: Record<string, string | undefined>): Record<string, string> | null {
  if (!origin || !isAppRoute(pathname) || !appOrigins(env).has(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}
