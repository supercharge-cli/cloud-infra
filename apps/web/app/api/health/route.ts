import { NextResponse } from 'next/server';
import { getPlan } from '@/lib/billing';
import { BRAND } from '@/lib/brand';
import { explainGatewayFailure, getGatewayUrl } from '@/lib/gateway-client';
import { resolveMongoDbName, resolveMongoUri } from '@/lib/mongodb';

export async function GET() {
  const plan = getPlan();
  const gatewayUrl = getGatewayUrl();
  const mongoUri = resolveMongoUri();
  const mongoConfigured = Boolean(mongoUri);
  const mongoSchemeOk =
    mongoConfigured &&
    (mongoUri.startsWith('mongodb://') || mongoUri.startsWith('mongodb+srv://'));

  let mongo: {
    ok: boolean;
    db?: string;
    users?: number;
    adminEmails?: string[];
    error?: string;
  } = { ok: false };

  if (mongoSchemeOk) {
    try {
      const { getDb } = await import('@/lib/mongodb');
      const db = await getDb();
      await db.command({ ping: 1 });
      const users = await db.collection('users').estimatedDocumentCount();
      mongo = {
        ok: true,
        db: resolveMongoDbName(),
        users,
      };
    } catch (e) {
      mongo = { ok: false, error: (e as Error).message.slice(0, 200) };
    }
  } else {
    mongo = {
      ok: false,
      error: mongoConfigured
        ? 'Invalid MONGODB_URI scheme'
        : 'MONGODB_URI not set',
    };
  }

  let gateway: {
    ok: boolean;
    url: string;
    status?: number;
    error?: string;
    isLocalhost?: boolean;
  } = {
    ok: false,
    url: gatewayUrl,
    isLocalhost:
      gatewayUrl.includes('127.0.0.1') ||
      gatewayUrl.includes('localhost') ||
      gatewayUrl.includes('0.0.0.0'),
  };

  if (gateway.isLocalhost && process.env.VERCEL === '1') {
    gateway.error =
      'Gateway URL is localhost — set XIBECODE_SANDBOX_GATEWAY_URL to public Railway/Coolify URL';
  } else {
    try {
      const token =
        process.env.XIBECODE_GATEWAY_TOKEN?.trim() ||
        process.env.XIBECODE_SANDBOX_AUTH_TOKEN?.trim() ||
        '';
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': 'VectraCloud-Health/1.0',
      };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/health`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      const text = await res.text();
      if (!res.ok || text.includes('Just a moment') || text.includes('<!DOCTYPE')) {
        gateway = {
          ...gateway,
          ok: false,
          status: res.status,
          error: explainGatewayFailure(res.status, text, `${gatewayUrl}/health`),
        };
      } else {
        gateway = { ...gateway, ok: true, status: res.status };
      }
    } catch (e) {
      gateway = {
        ...gateway,
        ok: false,
        error: (e as Error).message.slice(0, 240),
      };
    }
  }

  const ok = mongo.ok; // site can run for auth even if gateway is down
  return NextResponse.json({
    ok,
    service: 'vectra-cloud',
    brand: BRAND.name,
    authSecretSet: Boolean(process.env.AUTH_SECRET?.trim()),
    adminEmailsEnv: (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    bootstrapPasswordSet: Boolean(process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim()),
    mongo,
    gateway,
    plan: {
      id: plan.id,
      label: plan.label,
      priceInr: plan.priceInr,
      priceUsd: plan.priceUsd,
      periodDays: plan.periodDays,
    },
  });
}
