// src/app/api/weekly-schedule/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { normalise, matchCollection } from '@/lib/normalise'
import { buildScheduleEmailHtml, type Schedule } from '@/lib/schedule-email'

const resend = new Resend(process.env.RESEND_API_KEY)
const anthropic = new Anthropic()

export const maxDuration = 60

// ── Tuning knobs ──────────────────────────────────────────────────────────────
const MONTHS_LOOKBACK = 8          // how far back counts as "recently played"
const ALBUMS_PER_DAY = 3
const DAYS = 7
const TARGET_ALBUMS = ALBUMS_PER_DAY * DAYS
const DAYS_LOOKBACK = Math.round(MONTHS_LOOKBACK * 30.44)

const USERNAME = 'joel' // sole user; Phase 2 parameterises this

interface EligibleRow {
  artist: string
  album: string
  genre: string | null
  year: number | null
}

export async function GET(req: NextRequest) {
  // ── Auth: reject anything without the shared secret ─────────────────────────
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Only run on Sunday, Sydney time ─────────────────────────────────────────
  // Vercel Hobby crons fire ~daily and don't reliably honour day-of-week, so verify here.
  const sydneyDay = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'long',
  }).format(new Date())

  const force = req.nextUrl.searchParams.get('force') === 'true'
  if (sydneyDay !== 'Sunday' && !force) {
    return NextResponse.json({ skipped: true, reason: `Today is ${sydneyDay} in Sydney` })
  }

  try {
    // ── Eligible pool: never played, or not played in MONTHS_LOOKBACK ─────────
    // v_unplayed joins collection to spins with normalised name matching in SQL
    // and exposes days_since_played (NULL = never played).
    const { data: eligible, error: eligibleError } = await supabaseAdmin
      .from('v_unplayed')
      .select('artist, album, genre, year')
      .eq('username', USERNAME)
      .or(`days_since_played.is.null,days_since_played.gte.${DAYS_LOOKBACK}`) as {
        data: EligibleRow[] | null
        error: unknown
      }

    if (eligibleError) {
      console.error('weekly-schedule DB error:', eligibleError)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    const pool = eligible ?? []
    if (pool.length === 0) {
      return NextResponse.json({ sent: false, reason: 'No eligible albums', eligibleCount: 0 })
    }

    // ── Ask Claude to build the schedule ──────────────────────────────────────
    const albumList = pool
      .map(a => `${a.artist} — ${a.album}${a.year ? ` (${a.year})` : ''}${a.genre ? ` [${a.genre}]` : ''}`)
      .join('\n')

    // If the pool is short, allow artist repeats rather than returning a stub week.
    const allowRepeats = pool.length < TARGET_ALBUMS
    const artistRule = allowRepeats
      ? '- The list is short, so an artist may appear more than once across the week, but never twice on the same day.'
      : '- Do not repeat an artist across the whole week.'

    const system = `You are a knowledgeable record shop clerk building a week's listening schedule from someone's vinyl collection.

Rules:
- Monday through Sunday, exactly ${ALBUMS_PER_DAY} albums per day (${TARGET_ALBUMS} total). If the supplied list is smaller than ${TARGET_ALBUMS}, use every album exactly once and let the later days be shorter.
- Pick only from the supplied list. Never invent an album, and copy the artist and album names exactly as written.
${artistRule}
- Give each day a shape: group albums that flow together, or set up a deliberate contrast.
- For each day, write one short sentence (max 20 words) explaining the thread connecting that day's records.

Return ONLY valid JSON, no preamble and no markdown fences, in this exact shape:
{
  "intro": "one or two sentences framing the week",
  "days": [
    {
      "day": "Monday",
      "theme": "short theme title",
      "note": "one sentence on why these go together",
      "albums": [
        { "artist": "...", "album": "...", "why": "max 12 words" }
      ]
    }
  ]
}`

    const aiRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system,
      messages: [{
        role: 'user',
        content: `Here are the albums in my collection I haven't played in the past ${MONTHS_LOOKBACK} months:\n\n${albumList}\n\nBuild me the week.`,
      }],
    })

    const rawText = aiRes.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    // Strip markdown fences if the model added them anyway
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()

    let schedule: Schedule
    try {
      schedule = JSON.parse(cleaned)
    } catch {
      console.error('weekly-schedule: unparseable JSON from Claude:', cleaned.slice(0, 500))
      return NextResponse.json({ error: 'Claude returned unparseable JSON' }, { status: 500 })
    }
    if (!Array.isArray(schedule.days)) {
      return NextResponse.json({ error: 'Claude returned no days array' }, { status: 500 })
    }

    // ── Validate against the pool rather than trusting the model ──────────────
    // Drop anything not actually in the collection, and snap names to the
    // collection's own spelling so the email matches what's on the shelf.
    let dropped = 0
    for (const day of schedule.days) {
      day.albums = (day.albums ?? []).filter(a => {
        const match = matchCollection(a.artist ?? '', a.album ?? '', pool)
        if (!match) { dropped++; return false }
        a.artist = match.artist
        a.album = match.album
        return true
      })
    }

    const allAlbums = schedule.days.flatMap(d => d.albums)
    const artistCounts = new Map<string, number>()
    for (const a of allAlbums) {
      const key = normalise(a.artist)
      artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1)
    }
    const repeatedArtists = [...artistCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k)

    // ── Send the email ────────────────────────────────────────────────────────
    const html = buildScheduleEmailHtml(schedule, pool.length, MONTHS_LOOKBACK)

    // Week starts the Monday after the Sunday this runs on.
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() + 1)
    const dateLabel = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      day: 'numeric',
      month: 'long',
    }).format(weekStart)

    const to = process.env.SCHEDULE_EMAIL_TO ?? process.env.DIGEST_TO
    if (!to) {
      return NextResponse.json({ error: 'SCHEDULE_EMAIL_TO not set' }, { status: 500 })
    }

    const { data: sent, error: sendError } = await resend.emails.send({
      from: process.env.SCHEDULE_EMAIL_FROM ?? 'The Crate <onboarding@resend.dev>',
      to,
      subject: `The Crate — week of ${dateLabel}`,
      html,
    })

    if (sendError) {
      console.error('weekly-schedule Resend error:', sendError)
      return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
    }

    return NextResponse.json({
      sent: true,
      emailId: sent?.id,
      eligibleCount: pool.length,
      albumCount: allAlbums.length,
      dropped,
      repeatedArtists,
      allowedRepeats: allowRepeats,
    })
  } catch (err) {
    console.error('weekly-schedule failed:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
