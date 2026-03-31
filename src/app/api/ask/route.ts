import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic()
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json()
    if (!question?.trim()) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 })
    }

    const [spinsRes, collectionRes] = await Promise.all([
      supabase.from('spins').select('*').order('date_played', { ascending: false }),
      supabase.from('collection').select('*').order('artist'),
    ])

    const spins = spinsRes.data || []
    const collection = collectionRes.data || []

    const collectionText = collection
      .map(
        r =>
          `- ${r.artist} — ${r.album}${r.year ? ` (${r.year})` : ''}${r.genre ? ` [${r.genre}]` : ''}${r.notes ? ` | ${r.notes}` : ''}`
      )
      .join('\n')

    const spinsText = spins
      .map(s => `- ${s.date_played}: ${s.artist} — ${s.album}`)
      .join('\n')

    const system = `You are a knowledgeable assistant for a vinyl record collector. Answer questions concisely and helpfully based on their listening history and collection.

RECORD COLLECTION (${collection.length} albums):
${collectionText || '(empty)'}

SPINS LOG (${spins.length} total plays, most recent first):
${spinsText || '(no plays recorded yet)'}`

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: question.trim() }],
    })

    const answer = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    return NextResponse.json({ answer })
  } catch (error) {
    console.error('/api/ask error:', error)
    return NextResponse.json(
      { error: 'Failed to get answer. Make sure ANTHROPIC_API_KEY is set in Vercel.' },
      { status: 500 }
    )
  }
}
