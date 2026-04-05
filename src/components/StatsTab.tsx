'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Spin, Collection } from '@/types'

export default function StatsTab({ username }: { username: string }) {
  const [spins, setSpins] = useState<Spin[]>([])
  const [collection, setCollection] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('spins').select('*').eq('username', username).order('date_played', { ascending: false }),
      supabase.from('collection').select('*').eq('username', username),
    ]).then(([s, c]) => {
      setSpins(s.data || [])
      setCollection(c.data || [])
      setLoading(false)
    })
  }, [username])

  if (loading) return <p className="text-cream-dim text-sm">Loading…</p>

  // Top albums
  const albumMap: Record<string, { artist: string; album: string; count: number }> = {}
  for (const s of spins) {
    const key = `${s.artist.toLowerCase()}|||${s.album.toLowerCase()}`
    if (!albumMap[key]) albumMap[key] = { artist: s.artist, album: s.album, count: 0 }
    albumMap[key].count++
  }
  const topAlbums = Object.values(albumMap).sort((a, b) => b.count - a.count).slice(0, 10)

  // Top artists
  const artistMap: Record<string, { artist: string; count: number }> = {}
  for (const s of spins) {
    const key = s.artist.toLowerCase()
    if (!artistMap[key]) artistMap[key] = { artist: s.artist, count: 0 }
    artistMap[key].count++
  }
  const topArtists = Object.values(artistMap).sort((a, b) => b.count - a.count).slice(0, 10)

  // Genres (from collection)
  const genreMap: Record<string, number> = {}
  for (const r of collection) {
    if (r.genre) genreMap[r.genre] = (genreMap[r.genre] || 0) + 1
  }
  const topGenres = Object.entries(genreMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Formats (from collection)
  const formatMap: Record<string, number> = {}
  for (const r of collection) {
    if (r.format) formatMap[r.format] = (formatMap[r.format] || 0) + 1
  }
  const topFormats = Object.entries(formatMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Spins per month (last 12 months)
  const now = new Date()
  const monthKeys: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthCounts: Record<string, number> = Object.fromEntries(monthKeys.map(k => [k, 0]))
  for (const s of spins) {
    const key = s.date_played.slice(0, 7)
    if (key in monthCounts) monthCounts[key]++
  }
  const monthData = monthKeys.map(k => ({ key: k, count: monthCounts[k] }))
  const maxMonth = Math.max(...monthData.map(d => d.count), 1)

  function fmtMonth(key: string) {
    const [y, m] = key.split('-')
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }

  const maxAlbum = topAlbums[0]?.count || 1
  const maxArtist = topArtists[0]?.count || 1

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {[
          { value: spins.length, label: 'Total Spins' },
          { value: collection.length, label: 'In Collection' },
          { value: Object.keys(artistMap).length, label: 'Artists' },
        ].map(({ value, label }) => (
          <div key={label} className="bg-surface rounded-lg p-3 sm:p-4">
            <div className="text-cream text-xl sm:text-3xl font-bold">{value}</div>
            <div className="text-cream-dim text-[10px] sm:text-xs uppercase tracking-wider mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Monthly chart */}
      <div>
        <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Spins per Month</h2>
        <div className="bg-surface rounded-lg p-3 sm:p-5">
          <div className="flex items-end gap-px sm:gap-1" style={{ height: '80px' }}>
            {monthData.map(({ key, count }) => (
              <div key={key} className="flex-1 flex flex-col items-center justify-end gap-1 group h-full">
                <div
                  className="w-full bg-teal/30 group-hover:bg-teal/60 rounded-sm transition-colors"
                  style={{ height: `${Math.max((count / maxMonth) * 68, count > 0 ? 4 : 1)}px` }}
                  title={`${fmtMonth(key)}: ${count} spin${count !== 1 ? 's' : ''}`}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-px sm:gap-1 mt-2">
            {monthData.map(({ key }, i) => (
              <div key={key} className="flex-1 text-center">
                {i % 2 === 0 && (
                  <span className="text-cream-dim text-[8px] sm:text-[9px]">{fmtMonth(key)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top albums & artists */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        <div>
          <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Most Played Albums</h2>
          {topAlbums.length === 0 ? (
            <p className="text-cream-dim text-sm">No data yet.</p>
          ) : (
            <div className="space-y-3">
              {topAlbums.map((a, i) => (
                <div key={`${a.artist}${a.album}`}>
                  <div className="flex items-start justify-between mb-1 gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <span className="text-cream-dim text-xs shrink-0 w-5 mt-0.5">{i + 1}.</span>
                      <div className="min-w-0">
                        <div className="text-cream text-xs truncate">{a.album}</div>
                        <div className="text-cream-dim text-xs">{a.artist}</div>
                      </div>
                    </div>
                    <span className="text-cream-dim text-xs shrink-0">{a.count}×</span>
                  </div>
                  <div className="h-px bg-border rounded overflow-hidden ml-7">
                    <div
                      className="h-full bg-teal rounded transition-all"
                      style={{ width: `${(a.count / maxAlbum) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Most Played Artists</h2>
          {topArtists.length === 0 ? (
            <p className="text-cream-dim text-sm">No data yet.</p>
          ) : (
            <div className="space-y-3">
              {topArtists.map((a, i) => (
                <div key={a.artist}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-cream-dim text-xs shrink-0 w-5">{i + 1}.</span>
                      <span className="text-cream text-xs truncate">{a.artist}</span>
                    </div>
                    <span className="text-cream-dim text-xs shrink-0">{a.count}×</span>
                  </div>
                  <div className="h-px bg-border rounded overflow-hidden ml-7">
                    <div
                      className="h-full bg-accent rounded transition-all"
                      style={{ width: `${(a.count / maxArtist) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Genre breakdown */}
      {topGenres.length > 0 && (
        <div>
          <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Collection by Genre</h2>
          <div className="flex flex-wrap gap-2">
            {topGenres.map(([genre, count]) => (
              <div
                key={genre}
                className="flex items-center gap-2 px-3 py-1.5 bg-surface rounded-full border border-border"
              >
                <span className="text-cream text-xs">{genre}</span>
                <span className="text-cream-dim text-xs">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Format breakdown */}
      {topFormats.length > 0 && (
        <div>
          <h2 className="text-cream text-xs font-semibold uppercase tracking-widest mb-4">Collection by Format</h2>
          <div className="flex flex-wrap gap-2">
            {topFormats.map(([format, count]) => (
              <div
                key={format}
                className="flex items-center gap-2 px-3 py-1.5 bg-surface rounded-full border border-border"
              >
                <span className="text-cream text-xs">{format}</span>
                <span className="text-cream-dim text-xs">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
