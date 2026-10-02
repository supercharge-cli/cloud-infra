import { NextResponse } from 'next/server';
import { CATALOG } from '@/lib/managed-mcp/catalog';

export function GET() {
  return NextResponse.json({ schemaVersion: 1, plugins: CATALOG }, {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
