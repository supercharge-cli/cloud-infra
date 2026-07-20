import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { adminDeleteUser, adminSetRole } from '@/lib/admin-ops';
import {
  countInstancesForUser,
  createUser,
  listAllUsers,
  type UserRole,
} from '@/lib/store';

function errRes(e: unknown) {
  const err = e as Error & { status?: number };
  return NextResponse.json(
    { error: err.message || 'Forbidden' },
    { status: err.status || 500 },
  );
}

export async function GET() {
  try {
    await requireAdmin();
    const users = await listAllUsers();
    const withCounts = await Promise.all(
      users.map(async (u) => ({
        ...u,
        instanceCount: await countInstancesForUser(u.id),
      })),
    );
    return NextResponse.json({ users: withCounts });
  } catch (e) {
    return errRes(e);
  }
}

/** Create a user (admin). */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      email?: string;
      password?: string;
      role?: UserRole;
    };
    const email = String(body.email || '').trim();
    const password = String(body.password || '').trim();
    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 });
    }
    const user = await createUser(email, password, {
      role: body.role === 'admin' ? 'admin' : 'user',
    });
    const { publicUser } = await import('@/lib/store');
    return NextResponse.json({
      user: { ...publicUser(user), instanceCount: 0 },
    });
  } catch (e) {
    return errRes(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await req.json()) as { userId?: string; role?: UserRole };
    const userId = String(body.userId || '').trim();
    const role = body.role === 'admin' ? 'admin' : body.role === 'user' ? 'user' : null;
    if (!userId || !role) {
      return NextResponse.json({ error: 'userId and role (admin|user) required' }, { status: 400 });
    }
    const user = await adminSetRole(userId, role, admin.id);
    return NextResponse.json({ user });
  } catch (e) {
    return errRes(e);
  }
}

/**
 * Delete user.
 * ?id=…
 * &keepInstances=1 — leave instances owned by missing user (not recommended)
 * &hard=1 — hard-delete instance rows after destroy
 */
export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(req.url);
    const userId = url.searchParams.get('id')?.trim() || '';
    if (!userId) {
      return NextResponse.json({ error: 'id query required' }, { status: 400 });
    }
    if (userId === admin.id) {
      return NextResponse.json({ error: 'Cannot delete your own admin account' }, { status: 400 });
    }
    const keepInstances = url.searchParams.get('keepInstances') === '1';
    const hard = url.searchParams.get('hard') === '1';
    const result = await adminDeleteUser(userId, {
      destroyInstances: !keepInstances,
      hardDeleteInstances: hard,
    });
    return NextResponse.json(result);
  } catch (e) {
    return errRes(e);
  }
}
