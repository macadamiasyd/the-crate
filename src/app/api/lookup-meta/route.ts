import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

function capitalise(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

interface MetaResult {
  year: number | null
  genre: string | null
  cover_url: string | null
  cover_source: string | null
  mbid: string | null
}

async function queryMusicBrainz(artist: string, album: string): Promise<MetaResult> {
  const query = `artist:"${artist}" AND releasegroup:"${album}"`
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=3`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'TheCrate/1.0 (hello@macadamia.com.au)' },
  })

  if (!res.ok) return { year: null, genre: null, cover_url: null, cover_source: null, mbid: null }

  const data = await res.json()
  const releaseGroups = data['release-groups'] || []
  if (releaseGroups.length === 0) return { year: null, genre: null, cover_url: null, cover_source: null, mbid: null }

  // Prefer "Album" type, skip compilations
  const preferred = releaseGroups.find(
    (rg: { 'primary-type'?: string; 'secondary-types'?: string[] }) =>
      rg['primary-type'] === 'Album' && !rg['secondary-types']?.includes('Compilation')
  ) || releaseGroups[0]

  const mbid: string = preferred.id
  const yearStr = preferred['first-release-date']?.substring(0, 4)
  const yearNum = yearStr ? parseInt(yearStr) : NaN
  const year = !isNaN(yearNum) && yearNum >= 1900 && yearNum <= new Date().getFullYear() + 1 ? yearNum : null

  const tags: Array<{ name: string; count: number }> = preferred['tags'] || []
  tags.sort((a, b) => b.count - a.count)
  const genre = tags[0]?.name ? capitalise(tags[0].name) : null

  // Try Cover Art Archive
  let cover_url: string | null = null
  let cover_source: string | null = null
  try {
    const coverUrl = `https://coverartarchive.org/release-group/${mbid}/front-500`
    const coverRes = await fetch(coverUrl, { method: 'HEAD', redirect: 'follow' })
    if (coverRes.ok) {
      cover_url = coverUrl
      cover_source = 'musicbrainz'
    }
  } catch { /* no cover available */ }

  return { year, genre, cover_url, cover_source, mbid }
}

async function queryItunes(artist: string, album: string): Promise<{ cover_url: string | null; cover_source: string | null; year: number | null; genre: string | null }> {
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(artist + ' ' + album)}&entity=album&limit=1`
    const res = await fetch(itunesUrl)
    const data = await res.json()
    if (data.results?.length > 0) {
      const r = data.results[0]
      const cover_url = r.artworkUrl100?.replace('100x100', '600x600') || null
      const yearStr = r.releaseDate?.substring(0, 4)
      const yearNum = yearStr ? parseInt(yearStr) : NaN
      const year = !isNaN(yearNum) && yearNum >= 1900 && yearNum <= new Date().getFullYear() + 1 ? yearNum : null
      const genre = r.primaryGenreName || null
      return { cover_url, cover_source: cover_url ? 'itunes' : null, year, genre }
    }
  } catch { /* silent */ }
  return { cover_url: null, cover_source: null, year: null, genre: null }
}

async function queryDiscogs(artist: string, album: string): Promise<{ cover_url: string | null; cover_source: string | null; year: number | null; genre: string | null }> {
  const token = process.env.DISCOGS_TOKEN
  if (!token) return { cover_url: null, cover_source: null, year: null, genre: null }

  try {
    const discogsUrl = `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&type=release&per_page=5`
    const res = await fetch(discogsUrl, {
      headers: {
        'Authorization': `Discogs token=${token}`,
        'User-Agent': 'TheCrate/1.0',
      },
    })
    const data = await res.json()

    if (data.results?.length > 0) {
      // Prefer vinyl releases
      const vinyl = data.results.find((r: { format?: string[] }) =>
        r.format?.some((f: string) => f.toLowerCase().includes('vinyl'))
      )
      const chosen = vinyl || data.results[0]

      let cover_url: string | null = null
      let cover_source: string | null = null
      if (chosen.cover_image && !chosen.cover_image.includes('spacer.gif')) {
        cover_url = chosen.cover_image
        cover_source = 'discogs'
      }

      const yearNum = chosen.year ? parseInt(chosen.year) : NaN
      const year = !isNaN(yearNum) && yearNum >= 1900 && yearNum <= new Date().getFullYear() + 1 ? yearNum : null
      const genre = chosen.genre?.[0] ? capitalise(chosen.genre[0]) : null

      return { cover_url, cover_source, year, genre }
    }
  } catch (e) {
    console.error('Discogs error:', e)
  }
  return { cover_url: null, cover_source: null, year: null, genre: null }
}

async function queryHaiku(artist: string, album: string): Promise<{ year: number | null; genre: string | null }> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `For "${album}" by ${artist}: reply with ONLY two values separated by a pipe: the 4-digit release year and the primary genre. Example: "1959|Jazz". If unknown, use "unknown" for that field.`,
        },
      ],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    const parts = text.split('|').map(s => s.trim())
    const yearNum = parseInt(parts[0])
    const year = !isNaN(yearNum) && yearNum >= 1900 && yearNum <= new Date().getFullYear() + 1 ? yearNum : null
    const genre = parts[1] && parts[1].toLowerCase() !== 'unknown' ? capitalise(parts[1]) : null

    return { year, genre }
  } catch {
    return { year: null, genre: null }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { artist, album } = await req.json()
    if (!artist || !album) {
      return NextResponse.json({ year: null, genre: null, cover_url: null, cover_source: null, mbid: null }, { status: 400 })
    }

    // Step 1: MusicBrainz (year, genre, cover, mbid)
    const mb = await queryMusicBrainz(artist, album)
    let { year, genre, cover_url, cover_source, mbid } = mb

    // Step 2: iTunes fallback for missing cover
    if (!cover_url) {
      const itunes = await queryItunes(artist, album)
      if (itunes.cover_url) { cover_url = itunes.cover_url; cover_source = itunes.cover_source }
      if (!year && itunes.year) year = itunes.year
      if (!genre && itunes.genre) genre = itunes.genre
    }

    // Step 3: Discogs fallback if still no cover
    if (!cover_url) {
      const discogs = await queryDiscogs(artist, album)
      if (discogs.cover_url) { cover_url = discogs.cover_url; cover_source = discogs.cover_source }
      if (!year && discogs.year) year = discogs.year
      if (!genre && discogs.genre) genre = discogs.genre
    }

    // Step 4: Haiku fallback for year/genre only
    if (!year || !genre) {
      const haiku = await queryHaiku(artist, album)
      if (!year && haiku.year) year = haiku.year
      if (!genre && haiku.genre) genre = haiku.genre
    }

    return NextResponse.json({ year, genre, cover_url, cover_source, mbid })
  } catch (error) {
    console.error('/api/lookup-meta error:', error)
    return NextResponse.json({ year: null, genre: null, cover_url: null, cover_source: null, mbid: null }, { status: 500 })
  }
}
