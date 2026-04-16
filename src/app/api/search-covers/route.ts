import { NextRequest, NextResponse } from 'next/server'

interface CoverResult {
  url: string
  source: string
  mbid?: string | null
  title?: string
  artist?: string
  year?: string
  format?: string
}

async function searchMusicBrainz(query: string): Promise<CoverResult[]> {
  const mbUrl = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=10`
  const res = await fetch(mbUrl, {
    headers: { 'User-Agent': 'TheCrate/1.0 (hello@macadamia.com.au)' },
  })
  if (!res.ok) return []
  const data = await res.json()
  const covers: CoverResult[] = []

  for (const rg of data['release-groups'] || []) {
    const coverUrl = `https://coverartarchive.org/release-group/${rg.id}/front-500`
    try {
      const headRes = await fetch(coverUrl, { method: 'HEAD', redirect: 'follow' })
      if (headRes.ok) {
        covers.push({
          url: coverUrl,
          source: 'musicbrainz',
          mbid: rg.id,
          title: rg.title,
          artist: rg['artist-credit']?.[0]?.name,
          year: rg['first-release-date']?.substring(0, 4),
        })
      }
    } catch { /* skip */ }
    // Don't hammer the API
    if (covers.length >= 6) break
  }
  return covers
}

async function searchITunes(query: string): Promise<CoverResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=10`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return (data.results || [])
    .map((r: { artworkUrl100?: string; collectionName?: string; artistName?: string; releaseDate?: string }) => ({
      url: r.artworkUrl100?.replace('100x100', '600x600'),
      source: 'itunes',
      title: r.collectionName,
      artist: r.artistName,
      year: r.releaseDate?.substring(0, 4),
    }))
    .filter((r: CoverResult) => r.url)
}

async function searchDiscogs(query: string): Promise<CoverResult[]> {
  const token = process.env.DISCOGS_TOKEN
  if (!token) return []
  const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&per_page=10`
  const res = await fetch(url, {
    headers: {
      'Authorization': `Discogs token=${token}`,
      'User-Agent': 'TheCrate/1.0',
    },
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.results || [])
    .filter((r: { cover_image?: string }) => r.cover_image && !r.cover_image.includes('spacer.gif'))
    .map((r: { cover_image: string; title?: string; year?: string; format?: string[] }) => ({
      url: r.cover_image,
      source: 'discogs',
      title: r.title,
      year: r.year,
      format: r.format?.join(', '),
    }))
}

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json()
    if (!query) {
      return NextResponse.json({ results: [] }, { status: 400 })
    }

    const [mb, itunes, discogs] = await Promise.allSettled([
      searchMusicBrainz(query),
      searchITunes(query),
      searchDiscogs(query),
    ])

    const results: CoverResult[] = []
    if (mb.status === 'fulfilled') results.push(...mb.value)
    if (itunes.status === 'fulfilled') results.push(...itunes.value)
    if (discogs.status === 'fulfilled') results.push(...discogs.value)

    return NextResponse.json({ results })
  } catch (error) {
    console.error('/api/search-covers error:', error)
    return NextResponse.json({ results: [] }, { status: 500 })
  }
}
