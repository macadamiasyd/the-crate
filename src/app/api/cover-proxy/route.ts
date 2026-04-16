import { NextRequest } from 'next/server'

const ALLOWED_HOSTS = [
  'coverartarchive.org',
  'archive.org',         // CAA redirects here
  'ia800',               // archive.org image servers (ia800*.us.archive.org)
  'ia900',
  'itunes.apple.com',
  'is1-ssl.mzstatic.com', // iTunes CDN
  'is2-ssl.mzstatic.com',
  'is3-ssl.mzstatic.com',
  'is4-ssl.mzstatic.com',
  'is5-ssl.mzstatic.com',
  'img.discogs.com',
  'i.discogs.com',
  'st.discogs.com',
]

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.includes(h))
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')

  if (!url) {
    return new Response('Missing url parameter', { status: 400 })
  }

  // Only proxy known cover art sources (and Supabase storage URLs pass through directly)
  if (!isAllowedUrl(url)) {
    return new Response('URL not allowed', { status: 403 })
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TheCrate/1.0 (hello@macadamia.com.au)' },
      redirect: 'follow',
    })

    if (!res.ok) {
      return new Response('Upstream error', { status: res.status })
    }

    const contentType = res.headers.get('Content-Type') || 'image/jpeg'
    const body = await res.arrayBuffer()

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        // Browser cache: 30 days. Vercel edge cache: 1 year.
        // Album covers don't change — cache aggressively.
        'Cache-Control': 'public, max-age=2592000, s-maxage=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new Response('Fetch failed', { status: 502 })
  }
}
