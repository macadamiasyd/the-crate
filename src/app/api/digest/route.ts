// src/app/api/digest/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const resend = new Resend(process.env.RESEND_API_KEY)
const anthropic = new Anthropic()

export async function GET(req: NextRequest) {
  // Auth check
  const auth = req.headers.get('Authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const username = 'joel' // sole user; Phase 2 parameterises this

  // ── 1. Dust off — 5 longest-unplayed ─────────────────────────────────────
  const { data: dustOff } = await supabaseAdmin
    .from('v_unplayed')
    .select('artist, album, cover_url, last_played, days_since_played')
    .eq('username', username)
    .not('cover_url', 'is', null)
    .order('days_since_played', { ascending: false, nullsFirst: true })
    .limit(5)

  // ── 2. This week last year ────────────────────────────────────────────────
  const now = new Date()
  const oneYearAgo = new Date(now)
  oneYearAgo.setFullYear(now.getFullYear() - 1)
  const weekStart = new Date(oneYearAgo)
  weekStart.setDate(oneYearAgo.getDate() - oneYearAgo.getDay())
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  const { data: lastYear } = await supabaseAdmin
    .from('spins')
    .select('artist, album, date_played, cover_url')
    .eq('username', username)
    .gte('date_played', fmt(weekStart))
    .lte('date_played', fmt(weekEnd))
    .order('date_played')

  // ── 3. Stats snapshot ─────────────────────────────────────────────────────
  const thisWeekStart = fmt(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))
  const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const thirtyDaysAgo = fmt(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))

  const [{ count: spinsWeek }, { count: spinsMonth }, { data: recentSpins }] = await Promise.all([
    supabaseAdmin.from('spins').select('*', { count: 'exact', head: true }).eq('username', username).gte('date_played', thisWeekStart),
    supabaseAdmin.from('spins').select('*', { count: 'exact', head: true }).eq('username', username).gte('date_played', thisMonthStart),
    supabaseAdmin.from('spins').select('artist').eq('username', username).gte('date_played', thirtyDaysAgo),
  ])

  const artistCounts: Record<string, number> = {}
  for (const s of (recentSpins ?? [])) {
    artistCounts[s.artist] = (artistCounts[s.artist] || 0) + 1
  }
  const topArtist = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0]

  const stats = {
    spinsThisWeek: spinsWeek ?? 0,
    spinsThisMonth: spinsMonth ?? 0,
    topArtistName: topArtist?.[0] ?? 'n/a',
    topArtistPlays: topArtist?.[1] ?? 0,
  }

  // ── 4. Rotation note from Claude ──────────────────────────────────────────
  const notePrompt = [
    'Dust-off suggestions: ' + (dustOff ?? []).map(r => `${r.artist} — ${r.album}`).join(', '),
    'Same week last year: ' + (lastYear ?? []).map(r => `${r.artist} — ${r.album}`).join(', '),
    `Stats: ${stats.spinsThisWeek} plays this week, ${stats.spinsThisMonth} this month, top artist: ${stats.topArtistName} (${stats.topArtistPlays} plays).`,
  ].join('\n')

  const noteRes = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: 'Write a single short paragraph (2–4 sentences) as a warm rotation note for a vinyl collector\'s weekly digest. Use only the data provided — no fabricated details.',
    messages: [{ role: 'user', content: notePrompt }],
  })
  const rotationNote = noteRes.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')

  // ── Build HTML ────────────────────────────────────────────────────────────
  const thumbStyle = 'width:64px;height:64px;border-radius:4px;object-fit:cover;display:block;'
  const rowStyle = 'display:flex;align-items:center;gap:12px;margin-bottom:8px;'
  const labelStyle = 'font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;'
  const headStyle = 'font-size:18px;font-weight:700;color:#1a1a1a;margin:0 0 16px;'
  const dimStyle = 'font-size:13px;color:#666;'

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const albumRow = (artist: string, album: string, cover?: string | null) => `
    <div style="${rowStyle}">
      ${cover ? `<img src="${cover}" alt="" style="${thumbStyle}" />` : `<div style="${thumbStyle}background:#eee;"></div>`}
      <div>
        <div style="font-size:14px;color:#1a1a1a;">${esc(album)}</div>
        <div style="${dimStyle}">${esc(artist)}</div>
      </div>
    </div>`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#1a1a1a;background:#fff;">

  <h1 style="font-size:22px;font-weight:800;letter-spacing:0.05em;margin:0 0 4px;">THE CRATE</h1>
  <p style="${dimStyle}margin-bottom:32px;">${now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>

  <h2 style="${headStyle}">Dust Off</h2>
  <p style="${labelStyle}">You haven't played these in a while</p>
  ${(dustOff ?? []).map(r => albumRow(r.artist, r.album, r.cover_url)).join('')}

  ${(lastYear ?? []).length > 0 ? `
  <h2 style="${headStyle}margin-top:32px;">This Week Last Year</h2>
  ${lastYear!.map(r => albumRow(r.artist, r.album, r.cover_url)).join('')}
  ` : ''}

  <h2 style="${headStyle}margin-top:32px;">Week in Numbers</h2>
  <table style="border-collapse:collapse;font-size:14px;margin-bottom:24px;">
    <tr><td style="padding:4px 16px 4px 0;color:#888;">Plays this week</td><td style="font-weight:600;">${stats.spinsThisWeek}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#888;">Plays this month</td><td style="font-weight:600;">${stats.spinsThisMonth}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#888;">Top artist (30 days)</td><td style="font-weight:600;">${esc(stats.topArtistName)} &nbsp;<span style="color:#888;font-weight:400;">${stats.topArtistPlays}×</span></td></tr>
  </table>

  <h2 style="${headStyle}">Rotation Note</h2>
  <p style="font-size:15px;line-height:1.6;color:#333;">${esc(rotationNote)}</p>

  <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
  <p style="font-size:11px;color:#aaa;">The Crate · automated weekly digest</p>

</body>
</html>`

  // ── Send ──────────────────────────────────────────────────────────────────
  const { error } = await resend.emails.send({
    from: 'The Crate <onboarding@resend.dev>',
    to: process.env.DIGEST_TO!,
    subject: `The Crate — ${now.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`,
    html,
  })

  if (error) {
    console.error('Resend error:', error)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
