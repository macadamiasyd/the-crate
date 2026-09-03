'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyCoverUrl } from '@/lib/cover'
import { matchCollection } from '@/lib/normalise'
import type { Spin, Collection } from '@/types'

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
  | { status: 'loading' }
  | { status: 'confirm'; artist: string; album: string; year: number | null; genre: string | null; cover_url: string | null; format: string | null; confidence: string }

export default function LogTab({ username }: { username: string }) {
  const today = new Date().toISOString().split('T')[0]
  const [spins, setSpins] = useState<Spin[]>([])
  const [collection, setCollection] = useState<Collection[]>([])
  const [colQuery, setColQuery] = useState('')
  const [logDate, setLogDate] = useState(today)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [loggingId, setLoggingId] = useState<string | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [snap, setSnap] = useState<SnapState>(null)
  const snapInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadSpins(); loadCollectionList() }, [username])

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

  async function loadCollectionList() {
    const { data } = await supabase
      .from('collection')
      .select('*')
      .eq('username', username)
      .order('artist')
    setCollection((data ?? []) as Collection[])
  }

  /** Write one spin row from a record's metadata. Returns an error message, or null on success. */
  async function insertSpin(rec: Pick<Collection, 'artist' | 'album' | 'genre' | 'year' | 'format' | 'cover_url' | 'cover_source' | 'mbid'>, date: string): Promise<string | null> {
    const { error } = await supabase.from('spins').insert({
      username,
      artist: rec.artist,
      album: rec.album,
      genre: rec.genre ?? null,
      year: rec.year ?? null,
      format: rec.format ?? null,
      cover_url: rec.cover_url ?? null,
      cover_source: rec.cover_source ?? null,
      mbid: rec.mbid ?? null,
      date_played: date,
    })
    if (error) console.error('insertSpin failed:', error)
    return error?.message ?? null   // null = success
  }

  /** Log a play for a record already in the collection. */
  async function logFromCollection(record: Collection) {
    setLoggingId(record.id)
    const err = await insertSpin(record, logDate)
    if (!err) {
      showFlash(`Logged: ${record.album}`)
      setColQuery('')
      loadSpins()
    } else {
      showFlash(`Couldn't log: ${err}`, false)
    }
    setLoggingId(null)
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
      loadCollectionList()
    } catch { /* silent */ }
  }

  async function handleBulkImport() {
    const entries = parseBulkText(bulkText)
    if (!entries.length) { showFlash('No valid entries found', false); return }
    setBulkImporting(true)
    let count = 0

    for (const entry of entries) {
      // Reuse the collection's own metadata where we already own the record.
      const existing = matchCollection(entry.artist, entry.album, collection)
      const err = existing
        ? await insertSpin(existing, entry.date)
        : await insertSpin({
            artist: entry.artist, album: entry.album, genre: null, year: null,
            format: null, cover_url: null, cover_source: null, mbid: null,
          }, entry.date)
      if (!err) {
        if (!existing) await addToCollection(entry.artist, entry.album, null, null, null, null)
        count++
      }
    }

    showFlash(`Imported ${count} of ${entries.length} spins`)
    setBulkText('')
    setShowBulk(false)
    loadSpins()
    loadCollectionList()
    setBulkImporting(false)
  }

  /** Add a record to the collection and kick off Discogs enrichment. */
  async function addToCollection(
    artist: string, album: string, genre: string | null, year: number | null,
    format: string | null, cover_url: string | null,
  ): Promise<Collection | null> {
    const { data: created, error } = await supabase
      .from('collection')
      .insert({ username, artist, album, genre, year, format, cover_url })
      .select('*')
      .single()
    if (error) { console.error('addToCollection failed:', error); return null }
    if (created) {
      fetch('/api/discogs-enrich-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, id: created.id }),
      }).catch(() => { /* silent */ })
    }
    return created as Collection
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
      // Always land on the confirm card — its artist/album are editable, so a
      // low-confidence or wrong read is corrected here rather than in a separate form.
      setSnap({
        status: 'confirm',
        artist: data.artist || '',
        album: data.album || '',
        year: data.year ?? null,
        genre: data.genre || null,
        cover_url: data.cover_url || null,
        format: data.format || null,
        confidence: data.confidence || 'low',
      })
      if (data.confidence === 'low' || !data.artist) {
        showFlash('Low confidence — check the details before logging', false)
      }
    } catch {
      setSnap(null)
      showFlash('Photo ID failed', false)
    }
  }

  /**
   * Confirm a scanned sleeve.
   * Already in the collection -> just log the play against the owned record.
   * Not in the collection    -> add it, then log the play.
   */
  async function confirmSnap() {
    if (snap?.status !== 'confirm') return
    const artist = snap.artist.trim()
    const album = snap.album.trim()
    if (!artist || !album) { showFlash('Artist and album are both needed', false); return }

    setSubmitting(true)
    const existing = matchCollection(artist, album, collection)

    if (existing) {
      const err = await insertSpin(existing, logDate)
      if (!err) {
        setSnap(null)
        showFlash(`Logged: ${existing.album}`)
        loadSpins()
      } else {
        // Leave the card open so the button is a retry rather than a dead end.
        showFlash(`Couldn't log: ${err}`, false)
      }
    } else {
      const created = await addToCollection(artist, album, snap.genre, snap.year, snap.format, snap.cover_url)
      if (!created) {
        showFlash('Failed to add to collection', false)
        setSubmitting(false)
        return
      }
      const err = await insertSpin(created, logDate)
      if (!err) {
        setSnap(null)
        showFlash(`Added to collection and logged: ${album}`)
        loadSpins()
        loadCollectionList()
        autoLookupMeta(artist, album)
      } else {
        // The record is in the collection now but the play isn't recorded.
        // Refresh the collection first so pressing the button again takes the
        // "already owned" branch and simply logs the play — a clean retry
        // rather than a second copy of the record.
        showFlash(`Added to collection, but couldn't log the play: ${err}`, false)
        await loadCollectionList()
      }
    }
    setSubmitting(false)
  }

  async function deleteSpin(id: string) {
    if (!confirm('Delete this spin?')) return
    await supabase.from('spins').delete().eq('id', id)
    setSpins(prev => prev.filter(s => s.id !== id))
  }

  // Does the scanned sleeve correspond to something already owned? matchCollection
  // runs through lib/normalise, so this agrees with how the rest of the app matches.
  const snapMatch = snap?.status === 'confirm' && snap.artist.trim() && snap.album.trim()
    ? matchCollection(snap.artist.trim(), snap.album.trim(), collection)
    : null

  const COL_RESULT_LIMIT = 12
  const colFiltered = colQuery.trim()
    ? collection.filter(r => {
        const q = colQuery.toLowerCase()
        return (
          r.artist.toLowerCase().includes(q) ||
          r.album.toLowerCase().includes(q) ||
          (r.genre || '').toLowerCase().includes(q)
        )
      })
    : []
  const colTotal = colFiltered.length
  const colMatches = colFiltered.slice(0, COL_RESULT_LIMIT)

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

      {/* Log a spin */}
      <div className="bg-surface rounded-lg p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-cream text-xs font-semibold uppercase tracking-widest">Log a Spin</h2>
          <div className="flex items-center gap-2">
            <label className="text-cream-dim text-xs shrink-0">Date</label>
            <input
              type="date"
              value={logDate}
              onChange={e => setLogDate(e.target.value)}
              style={{ width: 'auto' }}
              className="text-xs"
            />
          </div>
        </div>

        {/* Snap a sleeve */}
        <div className="flex gap-3 items-center flex-wrap">
          <button
            type="button"
            onClick={() => snapInputRef.current?.click()}
            disabled={snap?.status === 'loading'}
            className="flex items-center gap-2 px-4 py-2 bg-surface2 text-cream border border-border rounded text-sm hover:border-teal hover:text-teal transition-colors disabled:opacity-50"
          >
            {snap?.status === 'loading' ? '📷 Identifying…' : '📷 Snap a sleeve'}
          </button>
          <span className="text-cream-dim text-xs">or search your collection below</span>
          <input
            ref={snapInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleSnapFile}
          />
        </div>

        {/* Scan confirm — artist/album stay editable so a bad read is fixed here */}
        {snap?.status === 'confirm' && (
          <div className={`bg-surface2 border rounded-lg p-4 ${snapMatch ? 'border-teal/40' : 'border-accent/40'}`}>
            <div className="flex gap-4 items-start">
              {snap.cover_url && (
                <img src={snap.cover_url} alt="" width={72} height={72} className="rounded shrink-0 object-cover" style={{ width: 72, height: 72 }} />
              )}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {snapMatch ? (
                    <span className="text-teal text-xs font-medium">✓ In your collection — this just logs a play</span>
                  ) : (
                    <span className="text-accent text-xs font-medium">＋ Not in your collection — will be added, then logged</span>
                  )}
                  <span className="text-cream-dim text-xs">{snap.confidence} confidence</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-cream-dim text-xs mb-1">Artist</label>
                    <input
                      value={snap.artist}
                      onChange={e => setSnap(s => s?.status === 'confirm' ? { ...s, artist: e.target.value } : s)}
                      placeholder="Artist name"
                    />
                  </div>
                  <div>
                    <label className="block text-cream-dim text-xs mb-1">Album</label>
                    <input
                      value={snap.album}
                      onChange={e => setSnap(s => s?.status === 'confirm' ? { ...s, album: e.target.value } : s)}
                      placeholder="Album title"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={confirmSnap}
                    disabled={submitting || !snap.artist.trim() || !snap.album.trim()}
                    className="px-3 py-1.5 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {submitting ? 'Logging…' : snapMatch ? '✓ Log this spin' : '✓ Add & log'}
                  </button>
                  <button onClick={() => setSnap(null)} className="px-3 py-1.5 text-cream-dim text-sm hover:text-cream">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search the collection */}
        <div>
          <input
            value={colQuery}
            onChange={e => setColQuery(e.target.value)}
            placeholder={`Search your collection (${collection.length} records)…`}
          />
          {colQuery.trim() && (
            <div className="mt-2 space-y-px max-h-80 overflow-y-auto">
              {colMatches.length === 0 ? (
                <p className="text-cream-dim text-sm py-2">
                  Nothing matching. Snap the sleeve to add it to your collection and log it.
                </p>
              ) : (
                colMatches.map(record => (
                  <button
                    key={record.id}
                    onClick={() => logFromCollection(record)}
                    disabled={loggingId !== null}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded text-left hover:bg-surface2 transition-colors disabled:opacity-50"
                  >
                    {record.cover_url ? (
                      <img
                        src={proxyCoverUrl(record.cover_url)!}
                        alt=""
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
                    <span className="flex-1 min-w-0">
                      <span className="block text-cream text-sm truncate">{record.album}</span>
                      <span className="block text-cream-dim text-xs truncate">
                        {record.artist}{record.year ? ` · ${record.year}` : ''}{record.format ? ` · ${record.format}` : ''}
                      </span>
                    </span>
                    <span className="text-cream-dim text-xs shrink-0">
                      {loggingId === record.id ? 'Logging…' : 'Log ▸'}
                    </span>
                  </button>
                ))
              )}
              {colTotal > colMatches.length && (
                <p className="text-cream-dim text-xs py-1.5">
                  Showing {colMatches.length} of {colTotal} matches — keep typing to narrow.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowBulk(v => !v)}
            className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors"
          >
            {showBulk ? 'Hide Import' : 'Bulk Import'}
          </button>
        </div>
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
