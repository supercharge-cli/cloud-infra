import { NextResponse } from 'next/server';
import { createSessionToken, setSessionCookie } from '@/lib/auth';
import { authenticateUser, publicUser } from '@/lib/store';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = String(body.email || '').trim();
    // do not trim password center; only ends (paste accidents)
    const password = String(body.password || '').replace(/^\s+|\s+$/g, '');
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      return NextResponse.json(
        {
          error: 'Invalid email or password',
          hint:
            'If this is the first deploy after a DB wipe, set ADMIN_EMAILS + ADMIN_BOOTSTRAP_PASSWORD on Vercel, redeploy, then login again. Check /api/health for mongo.ok.',
        },
        { status: 401 },
      );
    }
    const pub = publicUser(user);
    const token = createSessionToken({ id: user.id, email: user.email, role: pub.role });
    await setSessionCookie(token);
    return NextResponse.json({ user: pub });
  } catch (e) {
    const msg = (e as Error).message || 'Login failed';
    // Surface config errors clearly (mongo scheme, AUTH_SECRET)
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
