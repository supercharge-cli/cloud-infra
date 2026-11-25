import { createHash, randomBytes } from "node:crypto";

export const SANDBOX_HOST_PORT = 8788;
export const SANDBOX_SESSION_FILE = "/home/user/.vectrabot-session";

export function issueSandboxSession(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSandboxSession(token) };
}

export function hashSandboxSession(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Token travels on stdin, never in the command string. */
export function sandboxSessionInstall(): { command: string; path: string } {
  return {
    command: `umask 077; cat > ${SANDBOX_SESSION_FILE}`,
    path: SANDBOX_SESSION_FILE,
  };
}

export function attachDecision(input: {
  runtime: string;
  token?: string;
  url?: string;
}): { status: number; body: Record<string, unknown> } {
  if (input.runtime !== "supercharge") {
    return { status: 404, body: { error: "Supercharge session not found" } };
  }
  if (!input.token || !input.url) {
    return { status: 409, body: { error: "Sandbox session is not loaded" } };
  }
  return {
    status: 200,
    body: { url: input.url, token: input.token, port: SANDBOX_HOST_PORT },
  };
}
