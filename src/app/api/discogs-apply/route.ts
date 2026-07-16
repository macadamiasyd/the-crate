// src/app/api/discogs-apply/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PendingUpdate } from '@/app/api/discogs-enrich/route'

export async function POST(req: NextRequest) {
  const { username, items } = await req.json() as {
    username: string
    items: Array<{ id: string; pending: PendingUpdate }>
  }
  if (!username || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'username and items required' }, { status: 400 })
  }

  let applied = 0
  let errors = 0

  for (const { id, pending } of items) {
    const updates = { ...pending, discogs_synced_at: new Date().toISOString() }
    const { error } = await supabaseAdmin
      .from('collection')
      .update(updates)
      .eq('id', id)
      .eq('username', username)
    if (error) {
      errors++
      console.error('discogs-apply error for id', id, error)
    } else {
      applied++
    }
  }

  return NextResponse.json({ applied, errors })
}
