import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { matchCollection } from '@/lib/normalise'
import type { Collection } from '@/types'

const anthropic = new Anthropic()

export async function POST(req: NextRequest) {
  try {
    const { image, username } = await req.json() as { image: string; username: string }
    if (!image || !username) {
      return NextResponse.json({ error: 'image and username required' }, { status: 400 })
    }

    // Strip data URL prefix if present
    const base64 = image.replace(/^data:image\/[a-z]+;base64,/, '')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system: 'Identify the vinyl record in this photo. Respond with strict JSON only, no prose: {"artist":"...","album":"...","year":null,"confidence":"high"|"medium"|"low"}. Use null for year if unknown.',
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        }],
      }],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    let identified: { artist: string; album: string; year: number | null; confidence: string }
    try {
      identified = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '')
    } catch {
      return NextResponse.json({ confidence: 'low', artist: '', album: '', year: null })
    }

    // Snap to canonical collection names if we have a match
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: collection } = await supabase
      .from('collection')
      .select('artist, album, genre, year, cover_url, format')
      .eq('username', username) as { data: Collection[] | null }

    const match = matchCollection(identified.artist, identified.album, collection ?? [])

    return NextResponse.json({
      artist: match?.artist ?? identified.artist,
      album: match?.album ?? identified.album,
      year: match?.year ?? identified.year,
      genre: match?.genre ?? null,
      cover_url: match?.cover_url ?? null,
      format: match?.format ?? null,
      confidence: identified.confidence,
      matched: !!match,
    })
  } catch (err) {
    console.error('/api/identify error:', err)
    return NextResponse.json({ error: 'Identify failed' }, { status: 500 })
  }
}
