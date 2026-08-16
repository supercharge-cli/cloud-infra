import { NextResponse } from 'next/server';
import { createSessionToken, setSessionCookie } from '@/lib/auth';
import { createUser, publicUser } from '@/lib/store';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const user = await createUser(String(body.email || ''), String(body.password || ''));
    const pub = publicUser(user);
    const token = createSessionToken({ id: user.id, email: user.email, role: pub.role });
    await setSessionCookie(token);
    return NextResponse.json({ user: pub, token });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
