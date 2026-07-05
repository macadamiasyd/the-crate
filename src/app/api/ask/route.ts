// src/app/api/ask/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const anthropic = new Anthropic()

const ALLOWED_TABLES = ['spins', 'collection', 'v_unplayed']

function guardQuery(sql: string): string {
  const trimmed = sql.trim()
  if (!/^(select|with)\s/i.test(trimmed)) {
    throw new Error('Only SELECT and WITH queries are allowed')
  }
  const withoutTrailing = trimmed.replace(/;\s*$/, '')
  if (withoutTrailing.includes(';')) {
    throw new Error('Multiple statements not allowed')
  }
  const lc = withoutTrailing.toLowerCase()
  const mentionedTables = lc.match(/\bfrom\s+(\w+)/g)?.map(m => m.replace(/\bfrom\s+/, '')) ?? []
  const joinedTables = lc.match(/\bjoin\s+(\w+)/g)?.map(m => m.replace(/\bjoin\s+/, '')) ?? []
  for (const t of [...mentionedTables, ...joinedTables]) {
    if (!ALLOWED_TABLES.includes(t)) {
      throw new Error(`Table "${t}" is not in the allowlist (${ALLOWED_TABLES.join(', ')})`)
    }
  }
  if (!/\blimit\s+\d+/i.test(withoutTrailing)) {
    return withoutTrailing + ' LIMIT 200'
  }
  return withoutTrailing
}

const tools: Anthropic.Tool[] = [{
  name: 'run_query',
  description: 'Execute a read-only SQL query against the vinyl collection database. Always filter by username.',
  input_schema: {
    type: 'object' as const,
    properties: {
      sql: { type: 'string', description: 'A SELECT or WITH SQL statement. Must filter by username.' },
    },
    required: ['sql'],
  },
}]

export async function POST(req: NextRequest) {
  // Legacy CSV path (fallback)
  if (process.env.ASK_LEGACY_CSV === 'true') {
    return legacyAsk(req)
  }

  try {
    const { question, username } = await req.json()
    if (!question?.trim()) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 })
    }

    const today = new Date().toISOString().split('T')[0]
    const system = `You are a vinyl record assistant. Answer questions about the user's collection and listening history by querying the database using the run_query tool.

Database schema:
- spins(id, username, artist, album, genre, year, format, date_played, cover_url, created_at) — each row is one album play
- collection(id, username, artist, album, genre, year, format, cover_url, label, catno, lowest_price, num_for_sale, discogs_release_id, created_at) — owned records
- v_unplayed — collection joined to latest spin per record; includes all collection columns plus last_played (date or null), days_since_played (integer or null, null means never played)

Rules:
- Always add WHERE username = '${username}' to every query
- Prefer aggregate queries (COUNT, MAX, GROUP BY) over dumping all rows
- Answer in 2–4 sentences unless a list is asked for
- Today's date: ${today}`

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question.trim() }]

    for (let i = 0; i < 6; i++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        tools,
        messages,
      })

      messages.push({ role: 'assistant', content: response.content })

      if (response.stop_reason === 'end_turn') {
        const answer = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('')
        return NextResponse.json({ answer })
      }

      if (response.stop_reason !== 'tool_use') break

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        let result: string
        try {
          const safeSql = guardQuery((block.input as { sql: string }).sql)
          const { data, error } = await supabaseAdmin.rpc('exec_sql', { query: safeSql })
          if (error) throw error
          result = JSON.stringify(data ?? []).slice(0, 8000)
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
      }

      messages.push({ role: 'user', content: toolResults })
    }

    return NextResponse.json({ answer: 'Sorry, I could not answer that question.' })
  } catch (error) {
    console.error('/api/ask error:', error)
    return NextResponse.json({ error: 'Failed to get answer' }, { status: 500 })
  }
}

async function legacyAsk(req: NextRequest): Promise<NextResponse> {
  const { question, username } = await req.json()
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

  let spinsQ = sb.from('spins').select('*').order('date_played', { ascending: false })
  let colQ = sb.from('collection').select('*').order('artist')
  if (username) { spinsQ = spinsQ.eq('username', username); colQ = colQ.eq('username', username) }

  const [{ data: spins }, { data: col }] = await Promise.all([spinsQ, colQ])

  const system = `You are a vinyl record assistant.

COLLECTION (${(col ?? []).length} albums):
${(col ?? []).map((r: { artist: string; album: string; year?: number | null }) => `- ${r.artist} — ${r.album}${r.year ? ` (${r.year})` : ''}`).join('\n')}

SPINS (${(spins ?? []).length} plays):
${(spins ?? []).map((s: { date_played: string; artist: string; album: string }) => `- ${s.date_played}: ${s.artist} — ${s.album}`).join('\n')}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: question.trim() }],
  })
  const answer = response.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('')
  return NextResponse.json({ answer })
}
