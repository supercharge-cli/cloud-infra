import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { adminStats } from '@/lib/store';

export async function GET() {
  try {
    await requireAdmin();
    const stats = await adminStats();
    return NextResponse.json({ stats });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message || 'Forbidden' },
      { status: err.status || 500 },
    );
  }
}
