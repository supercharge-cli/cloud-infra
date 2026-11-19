import { NextResponse } from 'next/server';
import type { ServiceResult } from '@/lib/subscription-service';

/** Map a service result to JSON, keeping `ok` and error codes. */
export function respond<T>(result: ServiceResult<T>): NextResponse {
  if (!result.ok) {
    const { ok: _ok, status, ...body } = result;
    return NextResponse.json(body, { status });
  }
  return NextResponse.json(result);
}

export function serverError(scope: string, e: unknown): NextResponse {
  console.error(`[billing/subscriptions] ${scope}`, (e as Error)?.message || e);
  return NextResponse.json({ error: 'Billing is unavailable right now. Try again shortly.' }, { status: 500 });
}
