'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyCoverUrl } from '@/lib/cover'
import type { Wishlist } from '@/types'

type Form = { artist: string; album: string; genre: string; year: string; format: string; notes: string }
const EMPTY: Form = { artist: '', album: '', genre: '', year: '', format: '', notes: '' }

type Flash = { text: string; ok: boolean }

export default function WishlistTab({ username }: { username: string }) {
  const [records, setRecords] = useState<Wishlist[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)

  useEffect(() => { loadWishlist() }, [username])

  function showFlash(text: string, ok = true) {
    setFlash({ text, ok })
    setTimeout(() => setFlash(null), 3000)
  }

  async function loadWishlist() {
    const { data } = await supabase
      .from('wishlist')
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

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY)
    setShowModal(true)
  }

  function openEdit(r: Wishlist) {
    setEditingId(r.id)
    setForm({
      artist: r.artist,
      album: r.album,
      genre: r.genre || '',
      year: r.year ? String(r.year) : '',
      format: r.format || '',
      notes: r.notes || '',
    })
    setShowModal(true)
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

  async function autoLookupMeta(artist: string, album: string, id: string) {
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
      if (Object.keys(updates).length > 0) {
        await supabase.from('wishlist').update(updates).eq('id', id)
        loadWishlist()
      }
    } catch { /* silent */ }
  }

  async function handleSubmitModal(e: React.FormEvent) {
    e.preventDefault()
    if (!form.artist.trim() || !form.album.trim()) return
    setSubmitting(true)

    const payload = {
      artist: form.artist.trim(),
      album: form.album.trim(),
      genre: form.genre.trim() || null,
      year: form.year ? parseInt(form.year) : null,
      format: form.format.trim() || null,
      notes: form.notes.trim() || null,
    }

    if (editingId) {
      const { error } = await supabase.from('wishlist').update(payload).eq('id', editingId)
      if (!error) { setShowModal(false); showFlash('Updated!'); loadWishlist() }
      else showFlash('Update failed', false)
    } else {
      const { data: newItem, error } = await supabase.from('wishlist').insert({ ...payload, username }).select().single()
      if (!error && newItem) {
        setShowModal(false)
        showFlash('Added to wishlist!')
        loadWishlist()
        // Auto-lookup metadata in background
        autoLookupMeta(payload.artist, payload.album, newItem.id)
      } else showFlash('Failed to add', false)
    }
    setSubmitting(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this from your wishlist?')) return
    await supabase.from('wishlist').delete().eq('id', id)
    setRecords(prev => prev.filter(r => r.id !== id))
    showFlash('Removed')
  }

  async function handleBought(record: Wishlist) {
    const { data: existing } = await supabase
      .from('collection')
      .select('id')
      .eq('username', username)
      .ilike('artist', record.artist)
      .ilike('album', record.album)
      .maybeSingle()

    if (!existing) {
      const { error } = await supabase.from('collection').insert({
        username,
        artist: record.artist,
        album: record.album,
        genre: record.genre,
        year: record.year,
        format: record.format,
        cover_url: record.cover_url,
        mbid: record.mbid,
        notes: record.notes,
      })
      if (error) { showFlash('Failed to add to collection', false); return }
    }

    await supabase.from('wishlist').delete().eq('id', record.id)
    setRecords(prev => prev.filter(r => r.id !== record.id))
    showFlash(`Moved to collection: ${record.album}`)
  }

  return (
    <div className="space-y-5">
      {flash && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded text-sm font-medium shadow-lg ${flash.ok ? 'bg-teal text-bg' : 'bg-accent text-cream'}`}>
          {flash.text}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search artist, album, genre…"
          className="flex-1"
        />
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
        >
          + Add to Wishlist
        </button>
      </div>

      {/* Count */}
      <div className="text-cream-dim text-xs">
        {loading ? 'Loading…' : `${filtered.length}${filtered.length !== records.length ? ` of ${records.length}` : ''} record${records.length !== 1 ? 's' : ''}`}
      </div>

      {/* List */}
      {!loading && filtered.length === 0 ? (
        <p className="text-cream-dim text-sm">
          {records.length === 0 ? 'Wishlist is empty. Add records you want to buy.' : 'No results.'}
        </p>
      ) : (
        <div className="space-y-px">
          {filtered.map(record => (
            <div
              key={record.id}
              className="flex items-center gap-3 px-2 sm:px-3 py-2.5 rounded group hover:bg-surface transition-colors"
            >
              {record.cover_url ? (
                <img
                  src={proxyCoverUrl(record.cover_url)!}
                  alt=""
                  width={40}
                  height={40}
                  loading="lazy"
                  className="rounded-sm object-cover shrink-0"
                  style={{ width: 40, height: 40, background: 'rgba(232,220,200,0.05)' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <div
                  className="rounded-sm flex items-center justify-center shrink-0"
                  style={{
                    width: 40, height: 40,
                    background: 'rgba(232,220,200,0.05)',
                    border: '1px solid rgba(232,220,200,0.1)',
                    fontSize: 16,
                    color: 'rgba(232,220,200,0.2)',
                  }}
                >♪</div>
              )}
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
                <button
                  onClick={() => handleBought(record)}
                  className="px-2 py-1 text-xs text-teal border border-teal/50 rounded hover:bg-teal hover:text-bg transition-colors"
                  title="Move to collection"
                >
                  ✓ Bought!
                </button>
                <button
                  onClick={() => openEdit(record)}
                  className="px-2 py-1 text-xs text-cream-dim border border-border rounded hover:text-cream transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(record.id)}
                  className="px-2 py-1 text-xs text-cream-dim border border-border rounded hover:text-accent transition-colors"
                >
                  ✕
                </button>
              </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowModal(false)} />
          <div className="relative bg-surface border border-border rounded-lg p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-5">
              {editingId ? 'Edit Wishlist Item' : 'Add to Wishlist'}
            </h2>
            <form onSubmit={handleSubmitModal} className="space-y-3">
              <div>
                <label className="block text-cream-dim text-xs mb-1">Artist *</label>
                <input
                  value={form.artist}
                  onChange={e => setForm(f => ({ ...f, artist: e.target.value }))}
                  placeholder="Artist name"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-cream-dim text-xs mb-1">Album *</label>
                <input
                  value={form.album}
                  onChange={e => setForm(f => ({ ...f, album: e.target.value }))}
                  placeholder="Album title"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
              <div>
                <label className="block text-cream-dim text-xs mb-1">Format</label>
                <input
                  value={form.format}
                  onChange={e => setForm(f => ({ ...f, format: e.target.value }))}
                  placeholder="LP, 7&quot;, CD, Cassette…"
                />
              </div>
              <div>
                <label className="block text-cream-dim text-xs mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Notes…"
                  rows={3}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-accent text-cream rounded text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : editingId ? 'Update' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
