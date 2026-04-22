'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyCoverUrl } from '@/lib/cover'
import type { Collection, CoverSearchResult } from '@/types'

type Form = { artist: string; album: string; genre: string; year: string; format: string; notes: string }
const EMPTY: Form = { artist: '', album: '', genre: '', year: '', format: '', notes: '' }

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6,
  aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function parseBulkText(text: string): Array<{ artist: string; album: string }> {
  const DATE_RE = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,.]?\s*(\d{4})?$/
  const results: Array<{ artist: string; album: string }> = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(DATE_RE)
    if (m && MONTH_MAP[m[1].toLowerCase()] !== undefined) continue
    if (line.includes('\t')) {
      const parts = line.split('\t').map(s => s.trim()).filter(Boolean)
      if (parts.length >= 2) results.push({ album: parts[0], artist: parts[1] })
    }
  }
  return results
}

function parseCsv(text: string): Array<{ artist: string; album: string; genre?: string; year?: string; format?: string }> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []
  const sep = lines[0].includes('\t') ? '\t' : ','
  const firstCols = lines[0].split(sep).map(s => s.trim().toLowerCase().replace(/^["']|["']$/g, ''))
  const headerLike = firstCols.some(c => ['artist', 'album', 'title', 'genre', 'year', 'format'].includes(c))
  let headerMap: Record<string, number> = {}
  let startRow = 0
  if (headerLike) {
    firstCols.forEach((col, i) => { headerMap[col] = i })
    startRow = 1
  }
  const results: Array<{ artist: string; album: string; genre?: string; year?: string; format?: string }> = []
  for (let i = startRow; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(s => s.trim().replace(/^["']|["']$/g, ''))
    if (cols.length < 1) continue
    let artist = '', album = '', genre = '', year = '', format = ''
    if (Object.keys(headerMap).length > 0) {
      artist = cols[headerMap['artist']] || ''
      album = cols[headerMap['album'] ?? headerMap['title']] || ''
      genre = cols[headerMap['genre']] || ''
      year = cols[headerMap['year']] || ''
      format = cols[headerMap['format']] || ''
    } else if (cols.length >= 2) {
      artist = cols[0]; album = cols[1]
      if (cols.length >= 3) genre = cols[2]
      if (cols.length >= 4) year = cols[3]
      if (cols.length >= 5) format = cols[4]
    } else continue
    if (artist && album) results.push({ artist, album, genre: genre || undefined, year: year || undefined, format: format || undefined })
  }
  return results
}

async function compressImage(file: File, maxSize = 600, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const size = Math.min(img.width, img.height)
      const sx = (img.width - size) / 2
      const sy = (img.height - size) / 2
      const canvas = document.createElement('canvas')
      canvas.width = maxSize
      canvas.height = maxSize
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Compression failed')),
        'image/webp',
        quality,
      )
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = URL.createObjectURL(file)
  })
}

function CoverThumb({ url, size = 40, onContextMenu }: { url: string | null; size?: number; onContextMenu?: (e: React.MouseEvent) => void }) {
  const src = proxyCoverUrl(url)
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="rounded-sm object-cover shrink-0"
        style={{ width: size, height: size, background: 'rgba(232,220,200,0.05)' }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        onContextMenu={onContextMenu}
      />
    )
  }
  return (
    <div
      className="rounded-sm flex items-center justify-center shrink-0"
      style={{
        width: size, height: size,
        background: 'rgba(232,220,200,0.05)',
        border: '1px solid rgba(232,220,200,0.1)',
        fontSize: size * 0.4,
        color: 'rgba(232,220,200,0.2)',
      }}
      onContextMenu={onContextMenu}
    >
      ♪
    </div>
  )
}

/* ── Cover context menu ── */
function CoverMenu({ x, y, onAction, onClose }: {
  x: number; y: number
  onAction: (action: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const items = [
    { key: 'refresh', label: 'Refresh cover' },
    { key: 'search', label: 'Search covers' },
    { key: 'upload', label: 'Upload custom' },
    { key: 'remove', label: 'Remove cover' },
  ]
  return (
    <div
      ref={ref}
      className="fixed z-[200] bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: x, top: y }}
    >
      {items.map(i => (
        <button
          key={i.key}
          onClick={() => { onAction(i.key); onClose() }}
          className="w-full text-left px-3 py-2 text-xs text-cream-dim hover:bg-surface2 hover:text-cream transition-colors"
        >
          {i.label}
        </button>
      ))}
    </div>
  )
}

/* ── Cover search modal ── */
function CoverSearchModal({ item, onSelect, onClose }: {
  item: Collection
  onSelect: (cover: CoverSearchResult) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(`${item.artist} ${item.album}`)
  const [results, setResults] = useState<CoverSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { handleSearch() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSearch() {
    setLoading(true)
    try {
      const res = await fetch('/api/search-covers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      setResults(data.results || [])
    } catch { setResults([]) }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-lg p-5 sm:p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">
          Find cover for {item.artist} — <span className="italic">{item.album}</span>
        </h2>
        <div className="flex gap-2 mb-4">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search artist album…"
            className="flex-1"
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-3 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
          >
            {loading ? '…' : 'Search'}
          </button>
        </div>

        {loading && results.length === 0 && (
          <p className="text-cream-dim text-sm">Searching MusicBrainz, iTunes, Discogs…</p>
        )}

        {!loading && results.length === 0 && (
          <p className="text-cream-dim text-sm">No covers found. Try a different search.</p>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {results.map((r, i) => (
            <div
              key={`${r.source}-${i}`}
              onClick={() => onSelect(r)}
              className="cursor-pointer group"
            >
              <div className="w-full aspect-square rounded-sm overflow-hidden bg-[rgba(232,220,200,0.05)] border border-[rgba(232,220,200,0.1)] group-hover:border-cream-dim transition-colors">
                <img
                  src={proxyCoverUrl(r.url) || r.url}
                  alt={r.title || ''}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              </div>
              <div className="mt-1 leading-tight">
                {r.title && <div className="text-cream text-[11px] truncate">{r.title}</div>}
                {r.artist && <div className="text-cream-dim text-[10px] truncate">{r.artist}</div>}
                <div className="text-cream-dim text-[10px]">
                  {r.source}{r.year ? ` · ${r.year}` : ''}{r.format ? ` · ${r.format}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Refresh cover preview modal ── */
function RefreshPreviewModal({ coverUrl, onAccept, onSkip, onClose }: {
  coverUrl: string
  onAccept: () => void
  onSkip: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-lg p-5 w-full max-w-xs text-center">
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Use this cover?</h2>
        <img
          src={proxyCoverUrl(coverUrl) || coverUrl}
          alt="Cover preview"
          className="w-48 h-48 object-cover rounded-sm mx-auto mb-4"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div className="flex gap-3 justify-center">
          <button onClick={onAccept} className="px-4 py-2 bg-teal text-bg rounded text-sm font-medium hover:opacity-90">
            Use it
          </button>
          <button onClick={onSkip} className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors">
            Try another
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

type Flash = { text: string; ok: boolean }
type ViewMode = 'list' | 'grid'

export default function CollectionTab({ username }: { username: string }) {
  const [records, setRecords] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [csvImporting, setCsvImporting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [editingOriginal, setEditingOriginal] = useState<{ artist: string; album: string } | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [autoFilling, setAutoFilling] = useState(false)
  const [autoFillProgress, setAutoFillProgress] = useState('')
  const [backfilling, setBackfilling] = useState(false)
  const [backfillProgress, setBackfillProgress] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('crate-view-mode') as ViewMode) || 'list'
    return 'list'
  })
  const [detailRecord, setDetailRecord] = useState<Collection | null>(null)
  const [detailSpins, setDetailSpins] = useState<Array<{ id: string; date_played: string }>>([])
  const [detailNotesLoading, setDetailNotesLoading] = useState(false)
  const [detailNotesEditing, setDetailNotesEditing] = useState(false)
  const [detailNotesEditText, setDetailNotesEditText] = useState('')
  const [detailShowCredits, setDetailShowCredits] = useState(false)
  const [backfillingNotes, setBackfillingNotes] = useState(false)
  const [backfillNotesProgress, setBackfillNotesProgress] = useState('')

  // Cover management state
  const [coverMenu, setCoverMenu] = useState<{ x: number; y: number; item: Collection } | null>(null)
  const [coverSearchItem, setCoverSearchItem] = useState<Collection | null>(null)
  const [refreshPreview, setRefreshPreview] = useState<{ item: Collection; coverUrl: string; mbid: string | null; cover_source: string | null; skipMbids: string[]; skipUrls: string[] } | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] = useState<Collection | null>(null)

  useEffect(() => { loadCollection() }, [username])

  function showFlash(text: string, ok = true) {
    setFlash({ text, ok })
    setTimeout(() => setFlash(null), 3000)
  }

  function setView(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('crate-view-mode', mode)
  }

  async function loadCollection() {
    const { data } = await supabase
      .from('collection')
      .select('*')
      .eq('username', username)
      .order('artist')
      .order('year', { nullsFirst: false })
    setRecords(data || [])
    setLoading(false)
  }

  const filtered = records.filter(r => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      r.artist.toLowerCase().includes(q) ||
      r.album.toLowerCase().includes(q) ||
      (r.genre || '').toLowerCase().includes(q) ||
      (r.format || '').toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q)
    )
  })

  function openAdd() { setEditingId(null); setForm(EMPTY); setShowModal(true) }

  function openEdit(r: Collection) {
    setEditingId(r.id)
    setEditingOriginal({ artist: r.artist, album: r.album })
    setForm({ artist: r.artist, album: r.album, genre: r.genre || '', year: r.year ? String(r.year) : '', format: r.format || '', notes: r.notes || '' })
    setShowModal(true)
  }

  async function openDetail(r: Collection) {
    setDetailRecord(r)
    setDetailNotesEditing(false)
    setDetailShowCredits(false)
    const { data } = await supabase.from('spins').select('id, date_played').eq('username', username).ilike('artist', r.artist).ilike('album', r.album).order('date_played', { ascending: false })
    setDetailSpins(data || [])
  }

  async function lookupMeta() {
    if (!form.artist.trim() || !form.album.trim()) return
    setLookingUp(true)
    try {
      const res = await fetch('/api/lookup-meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist: form.artist.trim(), album: form.album.trim() }) })
      const data = await res.json()
      let found = false
      if (data.year) { setForm(f => ({ ...f, year: String(data.year) })); found = true }
      if (data.genre && !form.genre.trim()) { setForm(f => ({ ...f, genre: data.genre })); found = true }
      if (!found) showFlash('No data found', false)
    } catch { showFlash('Lookup failed', false) }
    setLookingUp(false)
  }

  async function autoLookupMeta(artist: string, album: string, id: string) {
    try {
      const res = await fetch('/api/lookup-meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist, album }) })
      const data = await res.json()
      const updates: Record<string, unknown> = {}
      if (data.genre) updates.genre = data.genre
      if (data.cover_url) updates.cover_url = data.cover_url
      if (data.cover_source) updates.cover_source = data.cover_source
      if (data.mbid) updates.mbid = data.mbid
      if (data.year) updates.year = data.year
      if (Object.keys(updates).length > 0) {
        await supabase.from('collection').update(updates).eq('id', id)
        await supabase.from('spins').update(updates).eq('username', username).ilike('artist', artist).ilike('album', album)
        loadCollection()
      }
    } catch { /* silent */ }
  }

  /* ── Cover management actions ── */

  function handleCoverContextMenu(e: React.MouseEvent, item: Collection) {
    e.preventDefault()
    setCoverMenu({ x: e.clientX, y: e.clientY, item })
  }

  function handleCoverAction(action: string, item: Collection) {
    switch (action) {
      case 'refresh': handleRefreshCover(item); break
      case 'search': setCoverSearchItem(item); break
      case 'upload': setUploadTarget(item); uploadInputRef.current?.click(); break
      case 'remove': handleRemoveCover(item); break
    }
  }

  async function handleRefreshCover(item: Collection, skipMbids: string[] = [], skipUrls: string[] = []) {
    const allSkipMbids = [...skipMbids, ...(item.mbid ? [item.mbid] : [])]
    const allSkipUrls = [...skipUrls, ...(item.cover_url ? [item.cover_url] : [])]

    setRefreshing(item.id)
    try {
      const res = await fetch('/api/refresh-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: item.artist, album: item.album, skipMbids: allSkipMbids, skipUrls: allSkipUrls }),
      })
      const data = await res.json()
      if (data.cover_url) {
        setRefreshPreview({
          item,
          coverUrl: data.cover_url,
          mbid: data.mbid,
          cover_source: data.cover_source,
          skipMbids: allSkipMbids,
          skipUrls: allSkipUrls,
        })
      } else {
        showFlash('No alternative covers found', false)
      }
    } catch { showFlash('Refresh failed', false) }
    setRefreshing(null)
  }

  async function acceptRefreshedCover() {
    if (!refreshPreview) return
    const { item, coverUrl, mbid, cover_source } = refreshPreview
    const dbUpdates = { cover_url: coverUrl, mbid, cover_source }
    const typedSource = cover_source as Collection['cover_source']
    const { error } = await supabase.from('collection').update(dbUpdates).eq('id', item.id)
    if (error) { console.error('Cover refresh update failed:', error); showFlash('Update failed: ' + error.message, false); setRefreshPreview(null); return }
    await supabase.from('spins').update(dbUpdates).eq('username', username).ilike('artist', item.artist).ilike('album', item.album)
    setRefreshPreview(null)
    // Update detail modal if open for this item
    if (detailRecord?.id === item.id) {
      setDetailRecord({ ...detailRecord, cover_url: coverUrl, mbid, cover_source: typedSource })
    }
    // Update local records immediately
    setRecords(prev => prev.map(r => r.id === item.id ? { ...r, cover_url: coverUrl, mbid, cover_source: typedSource } : r))
    showFlash('Cover updated!')
  }

  function skipRefreshedCover() {
    if (!refreshPreview) return
    const { item, coverUrl, mbid, skipMbids, skipUrls } = refreshPreview
    setRefreshPreview(null)
    handleRefreshCover(item, [...skipMbids, ...(mbid ? [mbid] : [])], [...skipUrls, coverUrl])
  }

  async function handleCoverSelected(cover: CoverSearchResult) {
    if (!coverSearchItem) return
    const updates = {
      cover_url: cover.url,
      cover_source: 'user_picked' as const,
      mbid: cover.mbid || null,
    }
    const { error } = await supabase.from('collection').update(updates).eq('id', coverSearchItem.id)
    if (error) { console.error('Collection cover update failed:', error); showFlash('Update failed: ' + error.message, false); return }
    await supabase.from('spins').update(updates).eq('username', username).ilike('artist', coverSearchItem.artist).ilike('album', coverSearchItem.album)
    // Update detail modal if open for this item
    if (detailRecord?.id === coverSearchItem.id) {
      setDetailRecord({ ...detailRecord, ...updates })
    }
    // Update local records immediately for instant UI feedback
    setRecords(prev => prev.map(r => r.id === coverSearchItem.id ? { ...r, ...updates } : r))
    setCoverSearchItem(null)
    showFlash('Cover updated!')
  }

  async function handleRemoveCover(item: Collection) {
    if (!confirm('Remove this cover?')) return
    // Clean up storage if it was a manual upload
    if (item.cover_source === 'manual_upload' && item.cover_url?.includes('/storage/v1/object/public/covers/')) {
      const filename = item.cover_url.split('/covers/').pop()
      if (filename) await supabase.storage.from('covers').remove([filename])
    }
    const updates = { cover_url: null as string | null, cover_source: null as string | null, mbid: null as string | null }
    const { error } = await supabase.from('collection').update(updates).eq('id', item.id)
    if (error) { console.error('Cover remove failed:', error); showFlash('Remove failed: ' + error.message, false); return }
    await supabase.from('spins').update(updates).eq('username', username).ilike('artist', item.artist).ilike('album', item.album)
    // Update detail modal if open for this item
    if (detailRecord?.id === item.id) {
      setDetailRecord({ ...detailRecord, cover_url: null, cover_source: null, mbid: null })
    }
    // Update local records immediately
    setRecords(prev => prev.map(r => r.id === item.id ? { ...r, cover_url: null, cover_source: null, mbid: null } : r))
    showFlash('Cover removed')
  }

  async function handleCustomUpload(item: Collection, file: File) {
    try {
      const compressed = await compressImage(file)
      const slug = `${item.artist}-${item.album}`.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 80)
      const filename = `${slug}-${Date.now()}.webp`

      // Clean up old manual upload first
      if (item.cover_source === 'manual_upload' && item.cover_url?.includes('/storage/v1/object/public/covers/')) {
        const oldFile = item.cover_url.split('/covers/').pop()
        if (oldFile) await supabase.storage.from('covers').remove([oldFile])
      }

      const { error } = await supabase.storage.from('covers').upload(filename, compressed, { contentType: 'image/webp', upsert: false })
      if (error) throw error

      const { data: urlData } = supabase.storage.from('covers').getPublicUrl(filename)
      const updates = { cover_url: urlData.publicUrl, cover_source: 'manual_upload' as const, mbid: null as string | null }
      await supabase.from('collection').update(updates).eq('id', item.id)
      await supabase.from('spins').update(updates).eq('username', username).ilike('artist', item.artist).ilike('album', item.album)
      if (detailRecord?.id === item.id) {
        setDetailRecord({ ...detailRecord, ...updates })
      }
      setRecords(prev => prev.map(r => r.id === item.id ? { ...r, ...updates } : r))
      showFlash('Cover uploaded!')
    } catch (e) {
      console.error('Upload failed:', e)
      showFlash('Upload failed', false)
    }
  }

  /* ── Notes ── */

  async function fetchAndCacheNotes(item: Collection) {
    setDetailNotesLoading(true)
    try {
      const res = await fetch('/api/lookup-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: item.artist, album: item.album }),
      })
      const data = await res.json()

      const updates: Partial<Collection> = {}
      if (data.notes_text) { updates.notes_text = data.notes_text; updates.notes_source = data.notes_source }
      if (data.credits) updates.credits = data.credits

      if (Object.keys(updates).length > 0) {
        await supabase.from('collection').update(updates).eq('id', item.id)
        const updated = { ...item, ...updates }
        setDetailRecord(updated)
        setRecords(prev => prev.map(r => r.id === item.id ? updated : r))
      }
    } catch (e) {
      console.error('Notes fetch failed:', e)
    }
    setDetailNotesLoading(false)
  }

  async function saveManualNotes(item: Collection, text: string) {
    const updates = { notes_text: text, notes_source: 'manual' as const }
    await supabase.from('collection').update(updates).eq('id', item.id)
    const updated = { ...item, ...updates }
    setDetailRecord(updated)
    setRecords(prev => prev.map(r => r.id === item.id ? updated : r))
    setDetailNotesEditing(false)
  }

  async function handleBackfillNotes() {
    setBackfillingNotes(true)
    const BATCH = 50
    const { data: missing } = await supabase
      .from('collection')
      .select('id, artist, album, notes_source')
      .eq('username', username)
      .or('notes_text.is.null,notes_text.eq.')
      .neq('notes_source', 'manual')

    if (!missing || missing.length === 0) {
      showFlash('All albums already have notes')
      setBackfillingNotes(false)
      return
    }

    const batch = missing.slice(0, BATCH)
    let found = 0

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i]
      setBackfillNotesProgress(`${i + 1} of ${batch.length}…`)
      try {
        const res = await fetch('/api/lookup-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artist: item.artist, album: item.album }),
        })
        const data = await res.json()
        const updates: Record<string, unknown> = {}
        if (data.notes_text) { updates.notes_text = data.notes_text; updates.notes_source = data.notes_source; found++ }
        if (data.credits) updates.credits = data.credits
        if (Object.keys(updates).length > 0) {
          await supabase.from('collection').update(updates).eq('id', item.id)
        }
      } catch { /* continue */ }
      if (i < batch.length - 1) await new Promise(r => setTimeout(r, 2000))
    }

    setBackfillingNotes(false)
    setBackfillNotesProgress('')
    const remaining = missing.length - batch.length
    showFlash(`Found notes for ${found} of ${batch.length}${remaining > 0 ? ` — ${remaining} remaining, tap again to continue` : ''}`)
    loadCollection()
  }

  /* ── Batch operations ── */

  async function handleAutoFillGenres() {
    const missing = records.filter(r => !r.genre)
    if (missing.length === 0) { showFlash('All records have genres'); return }
    if (!confirm(`Look up genres for ${missing.length} records? This may take a while.`)) return
    setAutoFilling(true)
    let updated = 0
    for (let i = 0; i < missing.length; i++) {
      const r = missing[i]
      setAutoFillProgress(`${i + 1} of ${missing.length}…`)
      try {
        const res = await fetch('/api/lookup-meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist: r.artist, album: r.album }) })
        const data = await res.json()
        const updates: Record<string, unknown> = {}
        if (data.genre) updates.genre = data.genre
        if (data.year && !r.year) updates.year = data.year
        if (data.cover_url && !r.cover_url) { updates.cover_url = data.cover_url; updates.cover_source = data.cover_source }
        if (data.mbid && !r.mbid) updates.mbid = data.mbid
        if (Object.keys(updates).length > 0) {
          await supabase.from('collection').update(updates).eq('id', r.id)
          await supabase.from('spins').update(updates).eq('username', username).ilike('artist', r.artist).ilike('album', r.album)
          updated++
        }
      } catch { /* continue */ }
      if (i < missing.length - 1) await new Promise(res => setTimeout(res, 1100))
    }
    setAutoFilling(false); setAutoFillProgress('')
    showFlash(`Updated ${updated} of ${missing.length} records`)
    loadCollection()
  }

  async function handleBackfillCovers() {
    // Skip records where user manually picked/uploaded a cover
    const missing = records.filter(r => !r.cover_url && r.cover_source !== 'user_picked' && r.cover_source !== 'manual_upload')
    if (missing.length === 0) { showFlash('All covers already filled'); return }
    if (!confirm(`Look up covers for ${missing.length} records? At ~1 sec each, this will take ~${Math.ceil(missing.length / 60)} min.`)) return
    setBackfilling(true)
    let updated = 0
    for (let i = 0; i < missing.length; i++) {
      const r = missing[i]
      setBackfillProgress(`${i + 1} of ${missing.length}…`)
      try {
        const res = await fetch('/api/lookup-meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist: r.artist, album: r.album }) })
        const data = await res.json()
        const updates: Record<string, unknown> = {}
        if (data.cover_url) { updates.cover_url = data.cover_url; updates.cover_source = data.cover_source }
        if (data.mbid) updates.mbid = data.mbid
        if (data.year && !r.year) updates.year = data.year
        if (data.genre && !r.genre) updates.genre = data.genre
        if (Object.keys(updates).length > 0) {
          await supabase.from('collection').update(updates).eq('id', r.id)
          await supabase.from('spins').update(updates).eq('username', username).ilike('artist', r.artist).ilike('album', r.album)
          updated++
        }
      } catch { /* continue */ }
      if (i < missing.length - 1) await new Promise(res => setTimeout(res, 1100))
    }
    setBackfilling(false); setBackfillProgress('')
    showFlash(`Done — updated ${updated} of ${missing.length} records`)
    loadCollection()
  }

  /* ── CRUD ── */

  async function handleSubmitModal(e: React.FormEvent) {
    e.preventDefault()
    if (!form.artist.trim() || !form.album.trim()) return
    setSubmitting(true)
    const payload = { artist: form.artist.trim(), album: form.album.trim(), genre: form.genre.trim() || null, year: form.year ? parseInt(form.year) : null, format: form.format.trim() || null, notes: form.notes.trim() || null }

    if (editingId) {
      const { error } = await supabase.from('collection').update(payload).eq('id', editingId)
      if (!error) {
        if (editingOriginal) {
          await supabase.from('spins').update({ artist: payload.artist, album: payload.album, genre: payload.genre, year: payload.year, format: payload.format }).eq('username', username).ilike('artist', editingOriginal.artist).ilike('album', editingOriginal.album)
        }
        setShowModal(false); showFlash('Updated!'); loadCollection()
      } else showFlash('Update failed', false)
    } else {
      const { data: newItem, error } = await supabase.from('collection').insert({ ...payload, username }).select().single()
      if (!error && newItem) {
        setShowModal(false); showFlash('Added to collection!'); loadCollection()
        autoLookupMeta(payload.artist, payload.album, newItem.id)
      } else showFlash('Failed to add', false)
    }
    setSubmitting(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this record from your collection?')) return
    await supabase.from('collection').delete().eq('id', id)
    setRecords(prev => prev.filter(r => r.id !== id))
    showFlash('Removed')
  }

  async function handleSpinIt(record: Collection) {
    const today = new Date().toISOString().split('T')[0]
    const { error } = await supabase.from('spins').insert({ username, artist: record.artist, album: record.album, genre: record.genre, year: record.year, format: record.format, cover_url: record.cover_url, cover_source: record.cover_source, mbid: record.mbid, date_played: today })
    if (!error) showFlash(`Logged: ${record.album}`)
    else showFlash('Failed to log spin', false)
  }

  async function handleBulkImport() {
    const entries = parseBulkText(bulkText)
    if (!entries.length) { showFlash('No entries found', false); return }
    setBulkImporting(true)
    let added = 0, skipped = 0
    for (const entry of entries) {
      const { data } = await supabase.from('collection').select('id').eq('username', username).ilike('artist', entry.artist).ilike('album', entry.album).maybeSingle()
      if (!data) {
        const { error } = await supabase.from('collection').insert({ username, artist: entry.artist, album: entry.album, genre: null, year: null, format: null })
        if (!error) added++
      } else skipped++
    }
    showFlash(`Added ${added} records${skipped ? ` (${skipped} already in collection)` : ''}`)
    setBulkText(''); setShowBulk(false); loadCollection(); setBulkImporting(false)
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvImporting(true)
    try {
      const text = await file.text()
      const entries = parseCsv(text)
      if (!entries.length) { showFlash('No valid rows found', false); setCsvImporting(false); return }
      let added = 0, skipped = 0
      for (const entry of entries) {
        const { data } = await supabase.from('collection').select('id').eq('username', username).ilike('artist', entry.artist).ilike('album', entry.album).maybeSingle()
        if (!data) {
          const yearNum = entry.year ? parseInt(entry.year) : null
          const { error } = await supabase.from('collection').insert({ username, artist: entry.artist, album: entry.album, genre: entry.genre || null, year: (yearNum && yearNum >= 1900 && yearNum <= 2099) ? yearNum : null, format: entry.format || null })
          if (!error) added++
        } else skipped++
      }
      showFlash(`Added ${added} records${skipped ? ` (${skipped} already in collection)` : ''}`)
      loadCollection()
    } catch { showFlash('CSV import failed', false) }
    setCsvImporting(false)
    e.target.value = ''
  }

  function formatDate(dateStr: string) {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="space-y-5">
      {flash && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded text-sm font-medium shadow-lg ${flash.ok ? 'bg-teal text-bg' : 'bg-accent text-cream'}`}>
          {flash.text}
        </div>
      )}

      {/* Hidden file input for cover uploads */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (file && uploadTarget) {
            await handleCustomUpload(uploadTarget, file)
            setUploadTarget(null)
            e.target.value = ''
          }
        }}
      />

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search artist, album, genre, format…" className="flex-1" />
        <div className="flex gap-2 sm:gap-3 flex-wrap">
          <div className="flex border border-border rounded overflow-hidden shrink-0">
            <button onClick={() => setView('list')} className={`px-2.5 py-2 text-xs transition-colors ${viewMode === 'list' ? 'bg-surface2 text-cream' : 'text-cream-dim hover:text-cream'}`} title="List view">☰</button>
            <button onClick={() => setView('grid')} className={`px-2.5 py-2 text-xs transition-colors ${viewMode === 'grid' ? 'bg-surface2 text-cream' : 'text-cream-dim hover:text-cream'}`} title="Grid view">⊞</button>
          </div>
          <button onClick={openAdd} className="flex-1 sm:flex-none px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0">+ Add</button>
          <button onClick={() => setShowBulk(v => !v)} className="flex-1 sm:flex-none px-3 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors whitespace-nowrap shrink-0">Bulk</button>
          <label className="flex-1 sm:flex-none px-3 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors whitespace-nowrap shrink-0 cursor-pointer text-center">
            {csvImporting ? '…' : 'CSV'}
            <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={handleCsvImport} className="hidden" />
          </label>
          <button onClick={handleAutoFillGenres} disabled={autoFilling || backfilling} className="flex-1 sm:flex-none px-3 py-2 bg-surface2 text-teal border border-teal/40 rounded text-sm hover:bg-teal hover:text-bg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50">
            {autoFilling ? autoFillProgress : 'Auto-fill Genres'}
          </button>
          <button onClick={handleBackfillCovers} disabled={backfilling || autoFilling} className="flex-1 sm:flex-none px-3 py-2 bg-surface2 text-accent border border-accent/40 rounded text-sm hover:bg-accent hover:text-cream transition-colors whitespace-nowrap shrink-0 disabled:opacity-50">
            {backfilling ? backfillProgress : 'Auto-fill Covers'}
          </button>
          <button onClick={handleBackfillNotes} disabled={backfillingNotes} className="flex-1 sm:flex-none px-3 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors whitespace-nowrap shrink-0 disabled:opacity-50">
            {backfillingNotes ? `Notes ${backfillNotesProgress}` : 'Auto-fill Notes'}
          </button>
        </div>
      </div>

      {/* Bulk import */}
      {showBulk && (
        <div className="bg-surface rounded-lg p-4 sm:p-5">
          <h3 className="text-cream text-xs font-semibold uppercase tracking-widest mb-2">Bulk Import to Collection</h3>
          <p className="text-cream-dim text-xs mb-3">Paste &ldquo;Album[Tab]Artist&rdquo; lines. Duplicate entries are skipped.</p>
          <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={'Kind of Blue\tMiles Davis\nRumours\tFleetwood Mac\nAbbey Road\tThe Beatles'} rows={8} className="font-mono text-xs" />
          <button onClick={handleBulkImport} disabled={bulkImporting || !bulkText.trim()} className="mt-3 px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {bulkImporting ? 'Importing…' : 'Import'}
          </button>
        </div>
      )}

      {/* Count */}
      <div className="text-cream-dim text-xs">
        {loading ? 'Loading…' : `${filtered.length}${filtered.length !== records.length ? ` of ${records.length}` : ''} record${records.length !== 1 ? 's' : ''}`}
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && !loading && filtered.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {filtered.map(record => (
            <div key={record.id} className="flex flex-col gap-1.5 cursor-pointer group relative">
              <div
                className="w-full aspect-square rounded-sm overflow-hidden bg-[rgba(232,220,200,0.05)] border border-[rgba(232,220,200,0.1)] group-hover:border-cream-dim transition-colors relative"
                onClick={() => openDetail(record)}
                onContextMenu={(e) => handleCoverContextMenu(e, record)}
              >
                {record.cover_url ? (
                  <img src={proxyCoverUrl(record.cover_url)!} alt={record.album} loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[32px] text-[rgba(232,220,200,0.2)]">♪</div>
                )}
                {/* Hover overlay with refresh button */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-start justify-end p-1 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRefreshCover(record) }}
                    className="w-6 h-6 rounded-full bg-black/60 text-cream text-xs flex items-center justify-center hover:bg-black/80 transition-colors"
                    title="Refresh cover"
                  >
                    {refreshing === record.id ? '…' : '↻'}
                  </button>
                </div>
              </div>
              <div className="leading-tight" onClick={() => openDetail(record)}>
                <div className="text-cream text-xs font-medium truncate">{record.artist}</div>
                <div className="text-cream-dim text-xs italic truncate">{record.album}</div>
                {record.year && <div className="text-cream-dim text-[11px]">{record.year}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && !loading && filtered.length === 0 ? (
        <p className="text-cream-dim text-sm">{records.length === 0 ? 'No records yet. Add your first above.' : 'No results.'}</p>
      ) : viewMode === 'list' && !loading && (
        <div className="space-y-px">
          {filtered.map(record => (
            <div key={record.id} className="flex items-center gap-3 px-2 sm:px-3 py-2.5 rounded group hover:bg-surface transition-colors">
              <div
                className="cursor-pointer shrink-0 relative"
                onClick={() => openDetail(record)}
                onContextMenu={(e) => handleCoverContextMenu(e, record)}
              >
                <CoverThumb url={record.cover_url} size={40} />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
                    <span className="text-cream text-sm font-medium truncate max-w-[50vw] sm:max-w-none">{record.album}</span>
                    <span className="text-cream-dim text-sm">— {record.artist}</span>
                    {record.year && <span className="text-cream-dim text-xs">({record.year})</span>}
                  </div>
                  <div className="flex gap-3 mt-0.5">
                    {record.format && <span className="text-cream-dim text-xs">{record.format}</span>}
                    {record.genre && <span className="text-cream-dim text-xs italic">{record.genre}</span>}
                    {record.notes && <span className="text-cream-dim text-xs truncate max-w-[70vw] sm:max-w-xs">{record.notes}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-2 sm:mt-0 sm:ml-4 sm:opacity-0 sm:group-hover:opacity-100 transition-all shrink-0">
                  <button onClick={() => handleSpinIt(record)} className="px-2 py-1 text-xs text-teal border border-teal/50 rounded hover:bg-teal hover:text-bg transition-colors" title="Log a spin today">Spin It</button>
                  <button onClick={() => openEdit(record)} className="px-2 py-1 text-xs text-cream-dim border border-border rounded hover:text-cream transition-colors">Edit</button>
                  <button onClick={() => handleDelete(record.id)} className="px-2 py-1 text-xs text-cream-dim border border-border rounded hover:text-accent transition-colors">✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cover context menu */}
      {coverMenu && (
        <CoverMenu
          x={coverMenu.x}
          y={coverMenu.y}
          onAction={(action) => handleCoverAction(action, coverMenu.item)}
          onClose={() => setCoverMenu(null)}
        />
      )}

      {/* Cover search modal */}
      {coverSearchItem && (
        <CoverSearchModal
          item={coverSearchItem}
          onSelect={handleCoverSelected}
          onClose={() => setCoverSearchItem(null)}
        />
      )}

      {/* Refresh cover preview */}
      {refreshPreview && (
        <RefreshPreviewModal
          coverUrl={refreshPreview.coverUrl}
          onAccept={acceptRefreshedCover}
          onSkip={skipRefreshedCover}
          onClose={() => setRefreshPreview(null)}
        />
      )}

      {/* Detail Modal */}
      {detailRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDetailRecord(null)} />
          <div className="relative bg-surface border border-border rounded-lg p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            {detailRecord.cover_url ? (
              <img
                src={proxyCoverUrl(detailRecord.cover_url.replace('front-500', 'front-1200'))!}
                alt={detailRecord.album}
                className="w-full max-w-[300px] mx-auto rounded-sm mb-4 cursor-pointer"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                onContextMenu={(e) => handleCoverContextMenu(e, detailRecord)}
              />
            ) : (
              <div className="w-full max-w-[300px] mx-auto aspect-square bg-[rgba(232,220,200,0.05)] border border-[rgba(232,220,200,0.1)] rounded-sm mb-4 flex items-center justify-center text-[48px] text-[rgba(232,220,200,0.2)] cursor-pointer" onContextMenu={(e) => handleCoverContextMenu(e, detailRecord)}>♪</div>
            )}
            <h2 className="text-cream text-lg font-medium">{detailRecord.artist}</h2>
            <h3 className="text-cream-dim text-base italic">{detailRecord.album}</h3>
            <div className="flex gap-2 mt-1 text-cream-dim text-sm flex-wrap">
              {detailRecord.year && <span>{detailRecord.year}</span>}
              {detailRecord.year && detailRecord.genre && <span>·</span>}
              {detailRecord.genre && <span>{detailRecord.genre}</span>}
              {detailRecord.format && <span>· {detailRecord.format}</span>}
            </div>
            {detailRecord.notes && <p className="text-cream-dim text-xs mt-2 italic">{detailRecord.notes}</p>}

            {/* Play history */}
            {detailSpins.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <h4 className="text-cream text-xs font-semibold uppercase tracking-widest mb-2">Plays ({detailSpins.length})</h4>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {detailSpins.map(s => (
                    <div key={s.id} className="text-cream-dim text-xs">{formatDate(s.date_played)}</div>
                  ))}
                </div>
              </div>
            )}

            {/* About this album */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-cream text-xs font-semibold uppercase tracking-widest">About this album</h4>
                <div className="flex gap-1.5">
                  {!detailNotesEditing && (
                    <button
                      onClick={() => { setDetailNotesEditText(detailRecord.notes_text || ''); setDetailNotesEditing(true) }}
                      className="text-[10px] text-cream-dim hover:text-cream transition-colors px-2 py-1 border border-border rounded uppercase tracking-wider"
                    >
                      {detailRecord.notes_text ? 'Edit' : 'Add'}
                    </button>
                  )}
                  {!detailRecord.notes_text && !detailNotesEditing && (
                    <button
                      onClick={() => fetchAndCacheNotes(detailRecord)}
                      disabled={detailNotesLoading}
                      className="text-[10px] text-teal hover:text-cream transition-colors px-2 py-1 border border-teal/40 rounded uppercase tracking-wider disabled:opacity-50"
                    >
                      {detailNotesLoading ? 'Looking up…' : 'Look up'}
                    </button>
                  )}
                  {detailRecord.notes_text && !detailNotesEditing && detailRecord.notes_source !== 'manual' && (
                    <button
                      onClick={() => fetchAndCacheNotes(detailRecord)}
                      disabled={detailNotesLoading}
                      className="text-[10px] text-cream-dim hover:text-cream transition-colors px-2 py-1 border border-border rounded uppercase tracking-wider disabled:opacity-50"
                    >
                      {detailNotesLoading ? '…' : '↻'}
                    </button>
                  )}
                </div>
              </div>

              {detailNotesEditing ? (
                <div>
                  <textarea
                    value={detailNotesEditText}
                    onChange={e => setDetailNotesEditText(e.target.value)}
                    rows={8}
                    placeholder="Write your own notes about this album…"
                    className="text-xs leading-relaxed"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => saveManualNotes(detailRecord, detailNotesEditText)}
                      className="px-3 py-1.5 bg-teal text-bg text-xs rounded font-medium hover:opacity-90"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setDetailNotesEditing(false)}
                      className="px-3 py-1.5 bg-surface2 text-cream-dim border border-border text-xs rounded hover:text-cream transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : detailNotesLoading ? (
                <p className="text-cream-dim text-xs italic">Looking up album info…</p>
              ) : detailRecord.notes_text ? (
                <div>
                  <p className="text-cream-dim text-xs leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto pr-1">
                    {detailRecord.notes_text}
                  </p>
                  <p className="text-cream-dim text-[10px] mt-2 uppercase tracking-wider opacity-50">
                    {detailRecord.notes_source === 'wikipedia' ? 'Wikipedia (CC BY-SA)' :
                     detailRecord.notes_source === 'lastfm' ? 'Last.fm' :
                     detailRecord.notes_source === 'discogs' ? 'Discogs' :
                     detailRecord.notes_source === 'manual' ? 'Your notes' : ''}
                  </p>
                </div>
              ) : (
                <p className="text-cream-dim text-xs italic opacity-60">No info found. Try &ldquo;Look up&rdquo; or write your own.</p>
              )}

              {/* Credits */}
              {detailRecord.credits && !detailNotesEditing && (
                <div className="mt-3">
                  <button
                    onClick={() => setDetailShowCredits(v => !v)}
                    className="text-[10px] text-cream-dim hover:text-cream transition-colors uppercase tracking-wider border border-border rounded px-2 py-1"
                  >
                    {detailShowCredits ? 'Hide Credits' : 'Show Credits'}
                  </button>
                  {detailShowCredits && (
                    <pre className="mt-2 text-cream-dim text-[11px] leading-relaxed whitespace-pre-wrap bg-[rgba(232,220,200,0.03)] border border-[rgba(232,220,200,0.08)] rounded p-3 max-h-40 overflow-y-auto font-sans">
                      {detailRecord.credits}
                    </pre>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5 flex-wrap pt-4 border-t border-border">
              <button onClick={() => { handleSpinIt(detailRecord); setDetailRecord(null) }} className="px-3 py-2 text-xs text-teal border border-teal/50 rounded hover:bg-teal hover:text-bg transition-colors">Spin It</button>
              <button onClick={() => { setDetailRecord(null); openEdit(detailRecord) }} className="px-3 py-2 text-xs text-cream-dim border border-border rounded hover:text-cream transition-colors">Edit</button>
              <button onClick={() => { handleRefreshCover(detailRecord) }} className="px-3 py-2 text-xs text-cream-dim border border-border rounded hover:text-cream transition-colors">↻ Cover</button>
              <button onClick={() => { setCoverSearchItem(detailRecord); setDetailRecord(null) }} className="px-3 py-2 text-xs text-cream-dim border border-border rounded hover:text-cream transition-colors">Search Cover</button>
              <button onClick={() => setDetailRecord(null)} className="px-3 py-2 text-xs text-cream-dim border border-border rounded hover:text-cream transition-colors ml-auto">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowModal(false)} />
          <div className="relative bg-surface border border-border rounded-lg p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-5">{editingId ? 'Edit Record' : 'Add Record'}</h2>
            <form onSubmit={handleSubmitModal} className="space-y-3">
              <div>
                <label className="block text-cream-dim text-xs mb-1">Artist *</label>
                <input value={form.artist} onChange={e => setForm(f => ({ ...f, artist: e.target.value }))} placeholder="Artist name" required autoFocus />
              </div>
              <div>
                <label className="block text-cream-dim text-xs mb-1">Album *</label>
                <input value={form.album} onChange={e => setForm(f => ({ ...f, album: e.target.value }))} placeholder="Album title" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-cream-dim text-xs mb-1">Genre</label>
                  <input value={form.genre} onChange={e => setForm(f => ({ ...f, genre: e.target.value }))} placeholder="Genre" />
                </div>
                <div>
                  <label className="block text-cream-dim text-xs mb-1">Year</label>
                  <div className="flex gap-1.5">
                    <input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} placeholder="YYYY" min="1900" max="2099" style={{ flex: 1 }} />
                    <button type="button" onClick={lookupMeta} disabled={lookingUp || !form.artist.trim() || !form.album.trim()} title="Auto-lookup metadata" className="px-2 bg-surface2 text-teal border border-border rounded text-xs hover:border-teal transition-colors disabled:opacity-30 shrink-0">
                      {lookingUp ? '…' : '?'}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-cream-dim text-xs mb-1">Format</label>
                <input value={form.format} onChange={e => setForm(f => ({ ...f, format: e.target.value }))} placeholder='LP, 7", CD, Cassette…' />
              </div>
              <div>
                <label className="block text-cream-dim text-xs mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes…" rows={3} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 disabled:opacity-50">{submitting ? 'Saving…' : editingId ? 'Update' : 'Add'}</button>
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
