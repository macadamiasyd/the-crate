// src/app/api/discogs-values/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchRelease } from '@/lib/discogs'
import type { Collection } from '@/types'

export const maxDuration = 300 // throttled batch — ~5 min for 294 records

export async function POST(req: NextRequest) {
  const { username } = await req.json() as { username: string }
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 })

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Rows with a release ID that haven't been valued recently
  const { data: rows, error: fetchError } = await supabaseAdmin
    .from('collection')
    .select('id, discogs_release_id, cover_url')
    .eq('username', username)
    .not('discogs_release_id', 'is', null)
    .or(`value_updated_at.is.null,value_updated_at.lt.${sevenDaysAgo}`) as { data: Collection[] | null; error: unknown }

  if (fetchError) return NextResponse.json({ error: 'DB error' }, { status: 500 })

  if (!rows?.length) return NextResponse.json({ updated: 0, total: 0 })

  let updated = 0
  let errors = 0

  for (const row of rows) {
    try {
      const details = await fetchRelease(row.discogs_release_id!)
      const updates: Partial<Collection> = {
        lowest_price: details.lowestPrice,
        num_for_sale: details.numForSale,
        value_updated_at: new Date().toISOString(),
      }
      if (details.styles.length) updates.styles = details.styles
      if (!row.cover_url && details.coverUrl) updates.cover_url = details.coverUrl

      const { error: updateError } = await supabaseAdmin
        .from('collection')
        .update(updates)
        .eq('id', row.id)
      if (updateError) throw updateError

      updated++
    } catch {
      errors++
    }
  }

  return NextResponse.json({ updated, errors, total: rows.length })
}
