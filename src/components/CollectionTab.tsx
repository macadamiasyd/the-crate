'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Collection } from '@/types'

type Form = { artist: string; album: string; genre: string; year: string; notes: string }
const EMPTY: Form = { artist: '', album: '', genre: '', year: '', notes: '' }

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

type Flash = { text: string; ok: boolean }

export default function CollectionTab() {
  const [records, setRecords] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)

  useEffect(() => { loadCollection() }, [])

  function showFlash(text: string, ok = true) {
    setFlash({ text, ok })
    setTimeout(() => setFlash(null), 3000)
  }

  async function loadCollection() {
    const { data } = await supabase.from('collection').select('*').order('artist')
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
      (r.notes || '').toLowerCase().includes(q)
    )
  })

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY)
    setShowModal(true)
  }

  function openEdit(r: Collection) {
    setEditingId(r.id)
    setForm({
      artist: r.artist,
      album: r.album,
      genre: r.genre || '',
      year: r.year ? String(r.year) : '',
      notes: r.notes || '',
    })
    setShowModal(true)
  }

  async function lookupYear() {
    if (!form.artist.trim() || !form.album.trim()) return
    setLookingUp(true)
    try {
      const res = await fetch('/api/lookup-year', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: form.artist.trim(), album: form.album.trim() }),
      })
      const data = await res.json()
      if (data.year) setForm(f => ({ ...f, year: String(data.year) }))
      else showFlash('Year not found', false)
    } catch {
      showFlash('Lookup failed', false)
    }
    setLookingUp(false)
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
      notes: form.notes.trim() || null,
    }

    if (editingId) {
      const { error } = await supabase.from('collection').update(payload).eq('id', editingId)
      if (!error) { setShowModal(false); showFlash('Updated!'); loadCollection() }
      else showFlash('Update failed', false)
    } else {
      const { error } = await supabase.from('collection').insert(payload)
      if (!error) { setShowModal(false); showFlash('Added to collection!'); loadCollection() }
      else showFlash('Failed to add', false)
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
    const { error } = await supabase.from('spins').insert({
      artist: record.artist,
      album: record.album,
      genre: record.genre,
      year: record.year,
      date_played: today,
    })
    if (!error) showFlash(`Logged: ${record.album}`)
    else showFlash('Failed to log spin', false)
  }

  async function handleBulkImport() {
    const entries = parseBulkText(bulkText)
    if (!entries.length) { showFlash('No entries found', false); return }
    setBulkImporting(true)
    let added = 0, skipped = 0

    for (const entry of entries) {
      const { data } = await supabase
        .from('collection')
        .select('id')
        .ilike('artist', entry.artist)
        .ilike('album', entry.album)
        .maybeSingle()

      if (!data) {
        const { error } = await supabase.from('collection').insert({
          artist: entry.artist,
          album: entry.album,
          genre: null,
          year: null,
        })
        if (!error) added++
      } else {
        skipped++
      }
    }

    showFlash(`Added ${added} records${skipped ? ` (${skipped} already in collection)` : ''}`)
    setBulkText('')
    setShowBulk(false)
    loadCollection()
    setBulkImporting(false)
  }

  return (
    <div className="space-y-5">
      {flash && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded text-sm font-medium shadow-lg ${flash.ok ? 'bg-teal text-bg' : 'bg-accent text-cream'}`}>
          {flash.text}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3">
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
          + Add Record
        </button>
        <button
          onClick={() => setShowBulk(v => !v)}
          className="px-4 py-2 bg-surface2 text-cream-dim border border-border rounded text-sm hover:text-cream transition-colors whitespace-nowrap shrink-0"
        >
          Bulk Import
        </button>
      </div>

      {/* Bulk import */}
      {showBulk && (
        <div className="bg-surface rounded-lg p-5">
          <h3 className="text-cream text-xs font-semibold uppercase tracking-widest mb-2">Bulk Import to Collection</h3>
          <p className="text-cream-dim text-xs mb-3">
            Paste &ldquo;Album[Tab]Artist&rdquo; lines. Duplicate entries are skipped.
          </p>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={'Kind of Blue\tMiles Davis\nRumours\tFleetwood Mac\nAbbey Road\tThe Beatles'}
            rows={8}
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

      {/* Count */}
      <div className="text-cream-dim text-xs">
        {loading ? 'Loading…' : `${filtered.length}${filtered.length !== records.length ? ` of ${records.length}` : ''} record${records.length !== 1 ? 's' : ''}`}
      </div>

      {/* List */}
      {!loading && filtered.length === 0 ? (
        <p className="text-cream-dim text-sm">
          {records.length === 0 ? 'No records yet. Add your first above.' : 'No results.'}
        </p>
      ) : (
        <div className="space-y-px">
          {filtered.map(record => (
            <div
              key={record.id}
              className="flex items-center justify-between px-3 py-3 rounded group hover:bg-surface transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-cream text-sm font-medium truncate">{record.album}</span>
                  <span className="text-cream-dim text-sm shrink-0">— {record.artist}</span>
                  {record.year && <span className="text-cream-dim text-xs shrink-0">({record.year})</span>}
                </div>
                <div className="flex gap-3 mt-0.5">
                  {record.genre && <span className="text-cream-dim text-xs italic">{record.genre}</span>}
                  {record.notes && (
                    <span className="text-cream-dim text-xs truncate max-w-xs">{record.notes}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 ml-4 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                <button
                  onClick={() => handleSpinIt(record)}
                  className="px-2 py-1 text-xs text-teal border border-teal/50 rounded hover:bg-teal hover:text-bg transition-colors"
                  title="Log a spin today"
                >
                  ▶ Spin It
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
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowModal(false)} />
          <div className="relative bg-surface border border-border rounded-lg p-6 w-full max-w-md">
            <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-5">
              {editingId ? 'Edit Record' : 'Add Record'}
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
                      onClick={lookupYear}
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
