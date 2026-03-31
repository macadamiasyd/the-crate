import { NextRequest, NextResponse } from 'next/server'

const PASSWORD = process.env.APP_PASSWORD ?? 'spinitbitch'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (password !== PASSWORD) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('crate-auth', 'ok', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return res
}
