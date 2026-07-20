import { NextResponse } from 'next/server';
import { getSessionUserWithRole } from '@/lib/auth';

export async function GET() {
  const user = await getSessionUserWithRole();
  if (!user) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
}
