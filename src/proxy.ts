import { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'crate-auth'
const TOKEN = 'ok'

// Cron-triggered routes. Vercel's scheduler sends no cookies, so the cookie gate
// would 302 them to /login and the route would never run. These routes each
// validate `Authorization: Bearer ${CRON_SECRET}` themselves — that is their gate.
const CRON_PATHS = ['/api/digest', '/api/weekly-schedule']

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname === '/login' || pathname.startsWith('/api/auth') || CRON_PATHS.includes(pathname)) {
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
