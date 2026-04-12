import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

function capitalise(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

async function queryMusicBrainz(artist: string, album: string): Promise<{ year: number | null; genre: string | null }> {
  const query = `artist:"${artist}" AND releasegroup:"${album}"`
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=1`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'TheCrate/1.0 (hello@macadamia.com.au)' },
  })

  if (!res.ok) return { year: null, genre: null }

  const data = await res.json()
  const rg = data['release-groups']?.[0]
  if (!rg) return { year: null, genre: null }

  const yearStr = rg['first-release-date']?.substring(0, 4)
  const yearNum = yearStr ? parseInt(yearStr) : NaN
  const year = !isNaN(yearNum) && yearNum >= 1900 && yearNum <= new Date().getFullYear() + 1 ? yearNum : null

  const tags: Array<{ name: string; count: number }> = rg['tags'] || []
  tags.sort((a, b) => b.count - a.count)
  const genre = tags[0]?.name ? capitalise(tags[0].name) : null

  return { year, genre }
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
      return NextResponse.json({ year: null, genre: null }, { status: 400 })
    }

    // Try MusicBrainz first
    const mb = await queryMusicBrainz(artist, album)

    // If we got both, return immediately
    if (mb.year && mb.genre) {
      return NextResponse.json(mb)
    }

    // Fall back to Haiku for missing fields
    const haiku = await queryHaiku(artist, album)

    return NextResponse.json({
      year: mb.year ?? haiku.year,
      genre: mb.genre ?? haiku.genre,
    })
  } catch (error) {
    console.error('/api/lookup-meta error:', error)
    return NextResponse.json({ year: null, genre: null }, { status: 500 })
  }
}
