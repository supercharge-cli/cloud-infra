/**
 * Admin-only operations: provision sandboxes, tear down, manage any user.
 */
import { addBillingPeriod, isSubscriptionActive } from "./billing";
import {
  bootstrapAppInbox,
  createGatewaySession,
  destroyGatewaySession,
  execInSession,
  restartDaemon,
  wakeSession,
} from "./gateway-client";
import {
  adminUpdateInstance,
  createInstanceRecord,
  deleteOrdersForUser,
  deleteUserById,
  findUserByEmail,
  findUserById,
  getInstanceById,
  hardDeleteInstance,
  listInstancesForUser,
  publicInstance,
  reassignInstance,
  type Instance,
  type PublicUser,
  publicUser,
  createUser,
  type UserRole,
} from "./store";

export async function adminProvisionInstance(input: {
  /** Existing user id */
  userId?: string;
  /** Or look up / create by email */
  email?: string;
  name?: string;
  /** Paid access days (default plan period) */
  days?: number;
  /** Create user if email not found (requires password) */
  createUserIfMissing?: boolean;
  password?: string;
  runtime?: "xibecode" | "supercharge";
}): Promise<{
  instance: ReturnType<typeof publicInstance>;
  owner: PublicUser;
  createdUser?: boolean;
}> {
  let userId = input.userId?.trim() || "";
  let owner = userId ? await findUserById(userId) : null;
  let createdUser = false;

  if (!owner && input.email) {
    owner = await findUserByEmail(input.email);
    if (!owner && input.createUserIfMissing) {
      const pw = (input.password || "").trim();
      if (pw.length < 8) {
        throw Object.assign(
          new Error("password min 8 chars when creating user"),
          { status: 400 },
        );
      }
      owner = await createUser(input.email, pw, { role: "user" });
      createdUser = true;
    }
  }

  if (!owner) {
    throw Object.assign(new Error("User not found — pass userId or email"), {
      status: 404,
    });
  }
  userId = owner.id;

  const runtime = input.runtime === "supercharge" ? "supercharge" : "xibecode";
  const session = await createGatewaySession({
    strategy: "sandbox_full",
    runtime,
  });
  const days =
    Math.max(1, Math.min(3650, Math.round(Number(input.days) || 0))) ||
    undefined;
  const paidUntil = addBillingPeriod(new Date(), days);

  const instance = await createInstanceRecord({
    userId,
    name: (input.name || "workspace").trim() || "workspace",
    sessionId: session.sessionId,
    sandboxId: session.sandboxId,
    runtime,
  });
  await bootstrapAppInbox(
    session.sessionId,
    session.sandboxId,
    instance.id,
    runtime,
  );
  if (runtime === "supercharge") {
    const restart = await restartDaemon(session.sessionId, session.sandboxId, runtime);
    if (!restart.ok) throw new Error("New Supercharge sandbox daemon could not adopt its instance identity");
  }
  const { applySavedPollinationsToNewInstance } =
    await import("@/lib/pollinations-account");
  await applySavedPollinationsToNewInstance({ userId, instance }).catch(
    () => undefined,
  );

  const withBilling = await adminUpdateInstance(instance.id, {
    paidUntil,
    billingStatus: "active",
    status: "running",
  });

  return {
    instance: publicInstance(withBilling || instance),
    owner: publicUser(owner),
    createdUser,
  };
}

export async function adminDestroyInstance(
  instanceId: string,
  opts?: { hard?: boolean },
): Promise<{ ok: true; hard: boolean }> {
  const inst = await getInstanceById(instanceId);
  if (!inst) {
    throw Object.assign(new Error("Instance not found"), { status: 404 });
  }

  try {
    await destroyGatewaySession(inst.sessionId);
  } catch {
    /* already gone */
  }

  if (opts?.hard) {
    await hardDeleteInstance(instanceId);
    return { ok: true, hard: true };
  }

  await adminUpdateInstance(instanceId, { status: "destroyed" });
  return { ok: true, hard: false };
}

export async function adminWakeInstance(instanceId: string): Promise<{
  ok: boolean;
  state?: string;
  logs: string[];
  instance?: ReturnType<typeof publicInstance>;
}> {
  const inst = await getInstanceById(instanceId);
  if (!inst)
    throw Object.assign(new Error("Instance not found"), { status: 404 });

  const result = await wakeSession(inst.sessionId, {
    sandboxId: inst.sandboxId,
    runtime: inst.runtime || "xibecode",
    restartDaemon: true,
  });
  const next = await adminUpdateInstance(instanceId, {
    status: result.ok ? "running" : "error",
    lastError: result.ok
      ? undefined
      : (result.message || result.logs.join("\n")).slice(0, 500),
  });
  return {
    ok: result.ok,
    state: result.state,
    logs: result.logs,
    instance: next ? publicInstance(next) : publicInstance(inst),
  };
}

export async function adminRestartDaemon(instanceId: string): Promise<{
  ok: boolean;
  logs: string[];
}> {
  const inst = await getInstanceById(instanceId);
  if (!inst)
    throw Object.assign(new Error("Instance not found"), { status: 404 });
  return restartDaemon(
    inst.sessionId,
    inst.sandboxId,
    inst.runtime || "xibecode",
  );
}

export async function adminExecOnInstance(
  instanceId: string,
  command: string,
  opts?: { cwd?: string; timeout?: number },
): Promise<{
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  cwd: string;
}> {
  const inst = await getInstanceById(instanceId);
  if (!inst)
    throw Object.assign(new Error("Instance not found"), { status: 404 });
  if (inst.status === "destroyed") {
    throw Object.assign(new Error("Instance destroyed"), { status: 410 });
  }

  const cwd =
    (opts?.cwd || "/home/user/workspace").trim() || "/home/user/workspace";
  const timeout = Math.min(300, Math.max(5, Math.round(opts?.timeout || 120)));
  const result = await execInSession(inst.sessionId, command, {
    timeout,
    cwd,
    sandboxId: inst.sandboxId,
    runtime: inst.runtime || "xibecode",
  });
  const exitCode =
    typeof result.exitCode === "number"
      ? result.exitCode
      : result.success === false
        ? 1
        : 0;

  await adminUpdateInstance(instanceId, {
    status: "running",
    lastError: undefined,
  }).catch(() => undefined);

  return {
    ok: exitCode === 0 && !result.error,
    exitCode,
    stdout: String(result.stdout || "").slice(0, 80_000),
    stderr: String(result.stderr || result.message || "").slice(0, 80_000),
    cwd,
  };
}

export async function adminDeleteUser(
  userId: string,
  opts?: { destroyInstances?: boolean; hardDeleteInstances?: boolean },
): Promise<{
  ok: true;
  destroyedInstances: number;
  deletedOrders: number;
}> {
  const user = await findUserById(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });

  const instances = await listInstancesForUser(userId);
  let destroyedInstances = 0;

  if (opts?.destroyInstances !== false) {
    for (const inst of instances) {
      if (inst.status === "destroyed" && !opts?.hardDeleteInstances) continue;
      try {
        await adminDestroyInstance(inst.id, {
          hard: Boolean(opts?.hardDeleteInstances),
        });
        destroyedInstances += 1;
      } catch {
        /* continue */
      }
    }
  }

  const deletedOrders = await deleteOrdersForUser(userId);
  await deleteUserById(userId);

  return { ok: true, destroyedInstances, deletedOrders };
}

export async function adminReassignInstance(
  instanceId: string,
  newUserId: string,
): Promise<Instance> {
  const next = await reassignInstance(instanceId, newUserId);
  if (!next)
    throw Object.assign(new Error("Instance not found"), { status: 404 });
  return next;
}

export async function adminSetRole(
  userId: string,
  role: UserRole,
  selfId: string,
): Promise<PublicUser> {
  if (userId === selfId && role !== "admin") {
    throw Object.assign(new Error("Cannot demote your own admin account"), {
      status: 400,
    });
  }
  const { setUserRole } = await import("./store");
  const user = await setUserRole(userId, role);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  return user;
}

export { isSubscriptionActive, publicInstance, publicUser };
