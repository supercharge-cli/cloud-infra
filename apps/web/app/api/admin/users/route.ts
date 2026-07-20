import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listAllUsers, setUserRole, type UserRole } from '@/lib/store';

export async function GET() {
  try {
    await requireAdmin();
    const users = await listAllUsers();
    return NextResponse.json({ users });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message || 'Forbidden' },
      { status: err.status || 500 },
    );
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
    // Prevent demoting yourself by accident
    if (userId === admin.id && role !== 'admin') {
      return NextResponse.json({ error: 'Cannot demote your own admin account' }, { status: 400 });
    }
    const user = await setUserRole(userId, role);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ user });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message || 'Forbidden' },
      { status: err.status || 500 },
    );
  }
}
