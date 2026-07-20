import { NextResponse } from 'next/server';
import { BRAND } from '@/lib/brand';
import { getGatewayUrl } from '@/lib/gateway-client';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'vectra-cloud',
    brand: BRAND.name,
    gatewayUrl: getGatewayUrl(),
    plan: BRAND.plan,
  });
}
