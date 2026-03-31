import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

export async function POST(req: NextRequest) {
  try {
    const { artist, album } = await req.json()
    if (!artist || !album) {
      return NextResponse.json({ year: null }, { status: 400 })
    }

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content: `What year was "${album}" by ${artist} first released? Reply with ONLY the 4-digit year. If unknown, reply "unknown".`,
        },
      ],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    const year = parseInt(text)
    const valid = !isNaN(year) && year >= 1900 && year <= new Date().getFullYear() + 1

    return NextResponse.json({ year: valid ? year : null })
  } catch (error) {
    console.error('/api/lookup-year error:', error)
    return NextResponse.json({ year: null }, { status: 500 })
  }
}
