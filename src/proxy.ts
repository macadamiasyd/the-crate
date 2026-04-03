import { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'crate-auth'
const TOKEN = 'ok'

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname === '/login' || pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  if (req.cookies.get(COOKIE)?.value !== TOKEN) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
