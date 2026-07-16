// src/app/api/discogs-values/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchRelease } from '@/lib/discogs'
import type { Collection } from '@/types'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { username } = await req.json() as { username: string }
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 })

  const BATCH = 100
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Count total eligible records first
  const { count, error: countError } = await supabaseAdmin
    .from('collection')
    .select('*', { count: 'exact', head: true })
    .eq('username', username)
    .not('discogs_release_id', 'is', null)
    .or(`value_updated_at.is.null,value_updated_at.lt.${sevenDaysAgo}`)
  if (countError) return NextResponse.json({ error: 'DB error' }, { status: 500 })

  const total = count ?? 0
  if (total === 0) return NextResponse.json({ updated: 0, errors: 0, total: 0, remaining: 0 })

  // Fetch one batch
  const { data: rows, error: fetchError } = await supabaseAdmin
    .from('collection')
    .select('id, discogs_release_id, cover_url')
    .eq('username', username)
    .not('discogs_release_id', 'is', null)
    .or(`value_updated_at.is.null,value_updated_at.lt.${sevenDaysAgo}`)
    .limit(BATCH) as { data: Collection[] | null; error: unknown }

  if (fetchError) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ updated: 0, errors: 0, total, remaining: 0 })

  let updated = 0
  let errors = 0
  const deadline = Date.now() + 240_000
  let processed = 0

  for (const row of rows) {
    if (Date.now() > deadline) break
    processed++
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

  const remaining = Math.max(0, total - processed)
  return NextResponse.json({ updated, errors, total: processed, remaining })
}
