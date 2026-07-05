'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyCoverUrl } from '@/lib/cover'
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

async function resizeToBase64(file: File, maxEdge = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = (err) => {
      URL.revokeObjectURL(url)
      reject(err)
    }
    img.src = url
  })
}

type Flash = { text: string; ok: boolean }

type SnapState =
  | null
  | { status: 'capturing' }
  | { status: 'loading' }
  | { status: 'confirm'; artist: string; album: string; year: number | null; genre: string | null; cover_url: string | null; format: string | null; confidence: string }

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
  const [snap, setSnap] = useState<SnapState>(null)
  const snapInputRef = useRef<HTMLInputElement>(null)

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

  async function ensureInCollection(artist: string, album: string, genre: string | null, year: number | null, format: string | null, cover_url: string | null = null, mbid: string | null = null) {
    const { data } = await supabase
      .from('collection')
      .select('id')
      .eq('username', username)
      .ilike('artist', artist)
      .ilike('album', album)
      .maybeSingle()
    if (!data) {
      await supabase.from('collection').insert({ username, artist, album, genre, year, format, cover_url, mbid })
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

  async function autoLookupMeta(artist: string, album: string) {
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
      if (data.cover_url) { updates.cover_url = data.cover_url; updates.cover_source = data.cover_source }
      if (data.mbid) updates.mbid = data.mbid
      if (Object.keys(updates).length === 0) return

      await supabase.from('spins').update(updates).eq('username', username).ilike('artist', artist).ilike('album', album)
      await supabase.from('collection').update(updates).eq('username', username).ilike('artist', artist).ilike('album', album)
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
      setForm({ artist: '', album: '', genre: '', year: '', format: '', date_played: today })
      showFlash('Spin logged!')
      loadSpins()
      // Auto-lookup metadata (cover, genre, year) in background
      autoLookupMeta(spin.artist, spin.album)
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

  async function handleSnapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (snap?.status === 'loading') return   // re-entrancy guard
    e.target.value = ''
    setSnap({ status: 'loading' })
    try {
      const base64 = await resizeToBase64(file)
      const res = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, username }),
      })
      const data = await res.json()
      if (data.confidence === 'low' || !data.artist) {
        setForm(f => ({
          ...f,
          artist: data.artist || '',
          album: data.album || '',
          year: data.year ? String(data.year) : '',
          genre: data.genre || '',
          format: data.format || '',
        }))
        setSnap(null)
        showFlash('Low confidence — please check and correct', false)
      } else {
        setSnap({
          status: 'confirm',
          artist: data.artist,
          album: data.album,
          year: data.year,
          genre: data.genre,
          cover_url: data.cover_url,
          format: data.format,
          confidence: data.confidence,
        })
      }
    } catch {
      setSnap(null)
      showFlash('Photo ID failed', false)
    }
  }

  async function confirmSnap() {
    if (snap?.status !== 'confirm') return
    const { artist, album, year, genre, cover_url, format } = snap
    setSnap(null)
    setSubmitting(true)
    const spin = {
      username,
      artist,
      album,
      genre: genre || null,
      year: year ?? null,
      format: format || null,
      date_played: today,
    }
    const { error } = await supabase.from('spins').insert(spin)
    if (!error) {
      await ensureInCollection(artist, album, genre, year, format, cover_url)
      showFlash('Spin logged!')
      loadSpins()
      autoLookupMeta(artist, album)
    } else {
      showFlash('Failed to log spin', false)
    }
    setSubmitting(false)
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

        {/* Snap button */}
        <div className="mb-4 flex gap-3 items-center">
          <button
            type="button"
            onClick={() => snapInputRef.current?.click()}
            disabled={snap?.status === 'loading'}
            className="flex items-center gap-2 px-4 py-2 bg-surface2 text-cream border border-border rounded text-sm hover:border-teal hover:text-teal transition-colors disabled:opacity-50"
          >
            {snap?.status === 'loading' ? '📷 Identifying…' : '📷 Snap'}
          </button>
          <span className="text-cream-dim text-xs">or fill in manually below</span>
          <input
            ref={snapInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleSnapFile}
          />
        </div>

        {/* Confirm card */}
        {snap?.status === 'confirm' && (
          <div className="mb-4 bg-surface2 border border-teal/30 rounded-lg p-4 flex gap-4 items-start">
            {snap.cover_url && (
              <img src={snap.cover_url} alt="" width={72} height={72} className="rounded shrink-0 object-cover" style={{ width: 72, height: 72 }} />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-cream font-medium">{snap.album}</div>
              <div className="text-cream-dim text-sm">{snap.artist}{snap.year ? ` · ${snap.year}` : ''}</div>
              {snap.genre && <div className="text-cream-dim text-xs mt-0.5 italic">{snap.genre}</div>}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={confirmSnap}
                  disabled={submitting}
                  className="px-3 py-1.5 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Logging…' : '✓ Log this spin'}
                </button>
                <button
                  onClick={() => {
                    if (snap.status === 'confirm') {
                      setForm(f => ({
                        ...f,
                        artist: snap.artist,
                        album: snap.album,
                        year: snap.year ? String(snap.year) : '',
                        genre: snap.genre || '',
                        format: snap.format || '',
                      }))
                    }
                    setSnap(null)
                  }}
                  className="px-3 py-1.5 bg-surface text-cream-dim border border-border rounded text-sm hover:text-cream"
                >
                  Edit
                </button>
                <button onClick={() => setSnap(null)} className="px-3 py-1.5 text-cream-dim text-sm hover:text-cream">
                  Cancel
                </button>
              </div>
            </div>
            <div className="text-xs text-cream-dim shrink-0">{snap.confidence} conf.</div>
          </div>
        )}

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
                      className="flex items-center gap-3 px-2 sm:px-3 py-2.5 rounded group hover:bg-surface2 transition-colors"
                    >
                      {spin.cover_url ? (
                        <img
                          src={proxyCoverUrl(spin.cover_url)!}
                          alt=""
                          width={36}
                          height={36}
                          loading="lazy"
                          className="rounded-sm object-cover shrink-0"
                          style={{ width: 36, height: 36, background: 'rgba(232,220,200,0.05)' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div
                          className="rounded-sm flex items-center justify-center shrink-0"
                          style={{
                            width: 36, height: 36,
                            background: 'rgba(232,220,200,0.05)',
                            border: '1px solid rgba(232,220,200,0.1)',
                            fontSize: 14,
                            color: 'rgba(232,220,200,0.2)',
                          }}
                        >♪</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
                          <span className="text-cream text-sm truncate max-w-[50vw] sm:max-w-none">{spin.album}</span>
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
