// src/app/api/discogs-enrich-one/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { searchRelease, fetchRelease } from '@/lib/discogs'
import { namesMatch } from '@/lib/normalise'
import type { Collection } from '@/types'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { username, id } = await req.json() as { username: string; id: string }
  if (!username || !id) return NextResponse.json({ error: 'username and id required' }, { status: 400 })

  const { data: row, error } = await supabaseAdmin
    .from('collection')
    .select('id, artist, album, cover_url, year, discogs_release_id')
    .eq('id', id)
    .eq('username', username)
    .maybeSingle() as { data: Collection | null; error: unknown }

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  if (!row) return NextResponse.json({ matched: false, reason: 'not found' })
  if (row.discogs_release_id) return NextResponse.json({ matched: false, reason: 'already enriched' })

  try {
    const match = await searchRelease(row.artist, row.album)
    if (!match) return NextResponse.json({ matched: false, reason: 'no results' })

    if (!namesMatch(row.artist, match.artist) || !namesMatch(row.album, match.title)) {
      return NextResponse.json({ matched: false, reason: 'name mismatch' })
    }

    const details = await fetchRelease(match.releaseId)

    const updates: Partial<Collection> = {
      discogs_release_id: match.releaseId,
      label: details.label ?? match.label,
      catno: details.catno ?? match.catno,
      lowest_price: details.lowestPrice,
      num_for_sale: details.numForSale,
      value_updated_at: new Date().toISOString(),
      discogs_synced_at: new Date().toISOString(),
    }
    if (details.styles.length) updates.styles = details.styles
    if (!row.cover_url && (details.coverUrl || match.coverUrl)) {
      updates.cover_url = details.coverUrl ?? match.coverUrl!
    }
    if (!row.year && match.year) updates.year = parseInt(match.year)

    const { error: updateError } = await supabaseAdmin
      .from('collection')
      .update(updates)
      .eq('id', row.id)
    if (updateError) throw updateError

    return NextResponse.json({ matched: true, releaseId: match.releaseId })
  } catch (err) {
    console.error(`discogs-enrich-one failed for ${row.artist} — ${row.album}:`, err)
    return NextResponse.json({ matched: false, reason: 'error' })
  }
}
