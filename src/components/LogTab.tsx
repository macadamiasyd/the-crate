'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Spin } from '@/types'

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6,
  aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function parseBulkText(text: string): Array<{ artist: string; album: string; date: string }> {
  const results: Array<{ artist: string; album: string; date: string }> = []
  const today = new Date().toISOString().split('T')[0]
  let currentDate = today
  const DATE_RE = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,.]?\s*(\d{4})?$/

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    const m = line.match(DATE_RE)
    if (m) {
      const monthNum = MONTH_MAP[m[1].toLowerCase()]
      if (monthNum !== undefined) {
        const day = parseInt(m[2])
        const year = m[3] ? parseInt(m[3]) : new Date().getFullYear()
        currentDate = `${year}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        continue
      }
    }

    if (line.includes('\t')) {
      const parts = line.split('\t').map(s => s.trim()).filter(Boolean)
      if (parts.length >= 2) {
        results.push({ album: parts[0], artist: parts[1], date: currentDate })
      }
    }
  }

  return results
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  })
}

type Flash = { text: string; ok: boolean }

export default function LogTab({ username }: { username: string }) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({ artist: '', album: '', genre: '', year: '', format: '', date_played: today })
  const [spins, setSpins] = useState<Spin[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)

  useEffect(() => { loadSpins() }, [username])

  function showFlash(text: string, ok = true) {
    setFlash({ text, ok })
    setTimeout(() => setFlash(null), 3000)
  }

  async function loadSpins() {
    const { data } = await supabase
      .from('spins')
      .select('*')
      .eq('username', username)
      .order('date_played', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000)
    setSpins(data || [])
    setLoading(false)
  }

  async function ensureInCollection(artist: string, album: string, genre: string | null, year: number | null, format: string | null) {
    const { data } = await supabase
      .from('collection')
      .select('id')
      .eq('username', username)
      .ilike('artist', artist)
      .ilike('album', album)
      .maybeSingle()
    if (!data) {
      await supabase.from('collection').insert({ username, artist, album, genre, year, format })
    }
  }

  async function lookupMeta() {
    if (!form.artist.trim() || !form.album.trim()) return
    setLookingUp(true)
    try {
      const res = await fetch('/api/lookup-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: form.artist.trim(), album: form.album.trim() }),
      })
      const data = await res.json()
      let found = false
      if (data.year) { setForm(f => ({ ...f, year: String(data.year) })); found = true }
      if (data.genre && !form.genre.trim()) { setForm(f => ({ ...f, genre: data.genre })); found = true }
      if (!found) showFlash('No data found', false)
    } catch {
      showFlash('Lookup failed', false)
    }
    setLookingUp(false)
  }

  async function autoLookupGenre(artist: string, album: string) {
    try {
      const res = await fetch('/api/lookup-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, album }),
      })
      const data = await res.json()
      const updates: Record<string, unknown> = {}
      if (data.genre) updates.genre = data.genre
      if (data.year) updates.year = data.year
      if (Object.keys(updates).length === 0) return

      await supabase.from('spins').update(updates).eq('username', username).ilike('artist', artist).ilike('album', album).is('genre', null)
      await supabase.from('collection').update(updates).eq('username', username).ilike('artist', artist).ilike('album', album).is('genre', null)
      loadSpins()
    } catch { /* silent */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.artist.trim() || !form.album.trim()) return
    setSubmitting(true)

    const spin = {
      username,
      artist: form.artist.trim(),
      album: form.album.trim(),
      genre: form.genre.trim() || null,
      year: form.year ? parseInt(form.year) : null,
      format: form.format.trim() || null,
      date_played: form.date_played,
    }

    const { error } = await supabase.from('spins').insert(spin)
    if (!error) {
      await ensureInCollection(spin.artist, spin.album, spin.genre, spin.year, spin.format)
      const needsLookup = !spin.genre
      setForm({ artist: '', album: '', genre: '', year: '', format: '', date_played: today })
      showFlash('Spin logged!')
      loadSpins()
      if (needsLookup) autoLookupGenre(spin.artist, spin.album)
    } else {
      showFlash('Failed to log spin', false)
    }
    setSubmitting(false)
  }

  async function handleBulkImport() {
    const entries = parseBulkText(bulkText)
    if (!entries.length) { showFlash('No valid entries found', false); return }
    setBulkImporting(true)
    let count = 0

    for (const entry of entries) {
      const { error } = await supabase.from('spins').insert({
        username,
        artist: entry.artist,
        album: entry.album,
        date_played: entry.date,
        genre: null,
        year: null,
        format: null,
      })
      if (!error) {
        await ensureInCollection(entry.artist, entry.album, null, null, null)
        count++
      }
    }

    showFlash(`Imported ${count} of ${entries.length} spins`)
    setBulkText('')
    setShowBulk(false)
    loadSpins()
    setBulkImporting(false)
  }

  async function deleteSpin(id: string) {
    if (!confirm('Delete this spin?')) return
    await supabase.from('spins').delete().eq('id', id)
    setSpins(prev => prev.filter(s => s.id !== id))
  }

  const grouped = spins.reduce<Record<string, Spin[]>>((acc, spin) => {
    if (!acc[spin.date_played]) acc[spin.date_played] = []
    acc[spin.date_played].push(spin)
    return acc
  }, {})
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-6">
      {flash && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded text-sm font-medium shadow-lg ${flash.ok ? 'bg-teal text-bg' : 'bg-accent text-cream'}`}>
          {flash.text}
        </div>
      )}

      {/* Log form */}
      <div className="bg-surface rounded-lg p-4 sm:p-5">
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Log a Spin</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-cream-dim text-xs mb-1">Artist</label>
              <input
                value={form.artist}
                onChange={e => setForm(f => ({ ...f, artist: e.target.value }))}
                placeholder="Artist name"
                required
              />
            </div>
            <div>
              <label className="block text-cream-dim text-xs mb-1">Album</label>
              <input
                value={form.album}
                onChange={e => setForm(f => ({ ...f, album: e.target.value }))}
                placeholder="Album title"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-cream-dim text-xs mb-1">Genre</label>
              <input
                value={form.genre}
                onChange={e => setForm(f => ({ ...f, genre: e.target.value }))}
                placeholder="Genre"
              />
            </div>
            <div>
              <label className="block text-cream-dim text-xs mb-1">Year</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  value={form.year}
                  onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                  placeholder="YYYY"
                  min="1900"
                  max="2099"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={lookupMeta}
                  disabled={lookingUp || !form.artist.trim() || !form.album.trim()}
                  title="Auto-lookup year via Claude"
                  className="px-2 bg-surface2 text-teal border border-border rounded text-xs hover:border-teal transition-colors disabled:opacity-30 shrink-0"
                >
                  {lookingUp ? '…' : '?'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-cream-dim text-xs mb-1">Format</label>
              <input
                value={form.format}
                onChange={e => setForm(f => ({ ...f, format: e.target.value }))}
                placeholder="LP, 7&quot;, CD…"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-cream-dim text-xs mb-1">Date Played</label>
              <input
                type="date"
                value={form.date_played}
                onChange={e => setForm(f => ({ ...f, date_played: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? 'Logging…' : 'Log Spin'}
            </button>
            <button
              type="button"
              onClick={() => setShowBulk(v => !v)}
              className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors"
            >
              {showBulk ? 'Hide Import' : 'Bulk Import'}
            </button>
          </div>
        </form>
      </div>

      {/* Bulk import */}
      {showBulk && (
        <div className="bg-surface rounded-lg p-4 sm:p-5">
          <h3 className="text-cream text-xs font-semibold uppercase tracking-widest mb-2">Bulk Import</h3>
          <p className="text-cream-dim text-xs mb-3">
            Paste Apple Notes format: date headers like &ldquo;Mar 28th&rdquo;, then &ldquo;Album[Tab]Artist&rdquo; lines.
          </p>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={'March 28th\nKind of Blue\tMiles Davis\nRumours\tFleetwood Mac\n\nMarch 27th\nAbbey Road\tThe Beatles'}
            rows={10}
            className="font-mono text-xs"
          />
          <button
            onClick={handleBulkImport}
            disabled={bulkImporting || !bulkText.trim()}
            className="mt-3 px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {bulkImporting ? 'Importing…' : 'Import'}
          </button>
        </div>
      )}

      {/* Spins list */}
      <div>
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Recent Spins</h2>
        {loading ? (
          <p className="text-cream-dim text-sm">Loading…</p>
        ) : spins.length === 0 ? (
          <p className="text-cream-dim text-sm">No spins yet. Log your first record above.</p>
        ) : (
          <div className="space-y-6">
            {dates.map(date => (
              <div key={date}>
                <div className="text-cream-dim text-xs uppercase tracking-wider mb-2 pb-1.5 border-b border-border">
                  {formatDate(date)}
                </div>
                <div className="space-y-px">
                  {grouped[date].map(spin => (
                    <div
                      key={spin.id}
                      className="flex items-start sm:items-center justify-between px-2 sm:px-3 py-2.5 rounded group hover:bg-surface2 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
                          <span className="text-cream text-sm truncate max-w-[60vw] sm:max-w-none">{spin.album}</span>
                          <span className="text-cream-dim text-sm">— {spin.artist}</span>
                        </div>
                        {(spin.year || spin.genre || spin.format) && (
                          <div className="flex gap-2 mt-0.5">
                            {spin.year && <span className="text-cream-dim text-xs">({spin.year})</span>}
                            {spin.format && <span className="text-cream-dim text-xs">{spin.format}</span>}
                            {spin.genre && <span className="text-cream-dim text-xs italic">{spin.genre}</span>}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => deleteSpin(spin.id)}
                        className="opacity-0 group-hover:opacity-100 text-cream-dim hover:text-accent text-xs ml-2 sm:ml-4 transition-all shrink-0"
                        title="Delete spin"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
