import { NextResponse } from 'next/server';
import { CATALOG } from '@/lib/managed-mcp/catalog';
import { DISCOVERY } from '@/lib/managed-mcp/discovery';

export function GET() {
  return NextResponse.json({ schemaVersion: 1, plugins: CATALOG, discovery: DISCOVERY }, {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
