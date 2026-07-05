// src/app/api/discogs-enrich/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { searchRelease } from '@/lib/discogs'
import { namesMatch } from '@/lib/normalise'
import type { Collection } from '@/types'

export const maxDuration = 300 // 5-minute max for throttled Discogs batch

export async function POST(req: NextRequest) {
  const { username } = await req.json() as { username: string }
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 })

  // Fetch collection rows missing discogs_release_id
  const { data: rows, error } = await supabaseAdmin
    .from('collection')
    .select('id, artist, album, cover_url, genre, year')
    .eq('username', username)
    .is('discogs_release_id', null) as { data: Collection[] | null; error: unknown }

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ updated: 0, skipped: 0, errors: 0, skippedList: [] })

  let updated = 0
  let skipped = 0
  let errors = 0
  const skippedList: string[] = []

  for (const row of rows) {
    try {
      const match = await searchRelease(row.artist, row.album)
      if (!match) {
        skipped++
        skippedList.push(`${row.artist} — ${row.album} (no results)`)
        continue
      }

      // Verify names match to avoid false positives
      if (!namesMatch(row.artist, match.artist) || !namesMatch(row.album, match.title)) {
        skipped++
        skippedList.push(`${row.artist} — ${row.album} (top result was "${match.artist} — ${match.title}")`)
        continue
      }

      const updates: Partial<Collection> = {
        discogs_release_id: match.releaseId,
        label: match.label,
        catno: match.catno,
        discogs_synced_at: new Date().toISOString(),
      }
      if (match.styles.length) updates.styles = match.styles
      // Only set cover_url if we don't already have one
      if (!row.cover_url && match.coverUrl) {
        updates.cover_url = match.coverUrl
      }
      // Only set year if we don't already have one
      if (!row.year && match.year) {
        updates.year = parseInt(match.year)
      }

      const { error: updateError } = await supabaseAdmin
        .from('collection')
        .update(updates)
        .eq('id', row.id)
      if (updateError) throw updateError

      updated++
    } catch (err) {
      errors++
      console.error(`Discogs enrich error for ${row.artist} — ${row.album}:`, err)
    }
  }

  return NextResponse.json({ updated, skipped, errors, skippedList, total: rows.length })
}
