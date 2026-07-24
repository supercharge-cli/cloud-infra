import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

/**
 * Public direct download of the Daytona / investor pitch deck.
 * GET /deck  → attachment: XibeCode-Daytona-Pitch.pptx
 *
 * Also available as static file:
 *   /deck/xibecode-daytona.pptx
 */
export const dynamic = 'force-static';

export async function GET() {
  const filePath = path.join(process.cwd(), 'public', 'deck', 'xibecode-daytona.pptx');
  try {
    const buf = await readFile(filePath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="XibeCode-Daytona-Pitch.pptx"',
        'Content-Length': String(buf.byteLength),
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
  }
}
