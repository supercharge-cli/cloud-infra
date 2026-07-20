import { NextResponse } from 'next/server';
import { getPlan } from '@/lib/billing';
import { BRAND } from '@/lib/brand';
import { getGatewayUrl } from '@/lib/gateway-client';

export async function GET() {
  const plan = getPlan();
  return NextResponse.json({
    ok: true,
    service: 'vectra-cloud',
    brand: BRAND.name,
    gatewayUrl: getGatewayUrl(),
    plan: {
      id: plan.id,
      label: plan.label,
      priceInr: plan.priceInr,
      priceUsd: plan.priceUsd,
      periodDays: plan.periodDays,
    },
  });
}
