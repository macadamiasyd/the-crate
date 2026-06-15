'use client'

import { useRef, useState, useEffect } from 'react'
import * as d3 from 'd3'
import { supabase } from '@/lib/supabase'
import type { Spin, Collection } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

interface AlbumStat {
  artist: string
  album: string
  plays: number
  genre: string
  year: number | null
  cover_url: string | null
  lastPlayed: string | null
}

interface ArtistStat {
  artist: string
  plays: number
  albumCount: number
  genre: string
  lastPlayed: string | null
}

interface DayStat {
  date: string
  plays: number
  albums: { artist: string; album: string }[]
}

type DailyStats = Record<string, DayStat>

interface TooltipState {
  x: number
  y: number
  data: AlbumStat | ArtistStat
}

// ── Genre colours ─────────────────────────────────────────────────────────────

const GENRE_COLOURS: Record<string, string> = {
  'Jazz': '#4a7c6f',
  'Jazz-Funk': '#5a9a80',
  'Jazz-Fusion': '#5a9a80',
  'Electronic/Jazz': '#4a8db5',
  'Avant-Garde Jazz': '#3a6a5f',
  'Rock': '#c45e3a',
  'Art Rock': '#d4724a',
  'Psychedelic Rock': '#b85a6a',
  'Progressive Rock': '#a05a7a',
  'Folk Rock': '#7a9a5a',
  'Alternative Rock': '#8b6bb1',
  'Indie Rock': '#9a7bc0',
  'Britpop': '#b08ad0',
  'Slowcore': '#7a6a9a',
  'Post-Punk': '#6a5a8a',
  'Electronic': '#4a8db5',
  'Ambient': '#5a7a9a',
  'Trip Hop': '#5a4a7a',
  'Drum & Bass': '#3a5a8a',
  'Electronic/Downtempo': '#4a6a9a',
  'Soul/R&B': '#d4a855',
  'Soul/Funk': '#d4b855',
  'Soul': '#c4a845',
  'Funk/Psychedelic': '#c49835',
  'Folk': '#7a9a5a',
  'Folk/Singer-Songwriter': '#8aaa6a',
  'Singer-Songwriter': '#8aaa6a',
  'Indie Folk': '#9aba7a',
  'Space Rock': '#7a6ab5',
  'Post-Rock': '#6a7ab0',
  'Synth-Pop': '#6a9ab5',
  'New Wave': '#5a8ab0',
  'Dream Pop': '#8a9ac5',
  'Pop': '#c4909a',
  'Pop/Rock': '#c48080',
  'Latin/World': '#c4a060',
  'Blues': '#4a6a8a',
}

function getGenreColour(genre: string | null | undefined): string {
  if (!genre) return 'rgba(232,220,200,0.3)'
  if (GENRE_COLOURS[genre]) return GENRE_COLOURS[genre]
  for (const [key, colour] of Object.entries(GENRE_COLOURS)) {
    if (genre.toLowerCase().includes(key.toLowerCase())) return colour
  }
  return 'rgba(232,220,200,0.3)'
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function computeAlbumStats(spins: Spin[], collection: Collection[]): AlbumStat[] {
  const counts: Record<string, AlbumStat> = {}
  for (const s of spins) {
    const key = `${s.artist}|||${s.album}`
    if (!counts[key]) {
      counts[key] = {
        artist: s.artist,
        album: s.album,
        plays: 0,
        genre: s.genre || '',
        year: s.year,
        cover_url: s.cover_url,
        lastPlayed: null,
      }
    }
    counts[key].plays++
    if (!counts[key].lastPlayed || s.date_played > counts[key].lastPlayed!) {
      counts[key].lastPlayed = s.date_played
    }
  }
  for (const c of collection) {
    const key = `${c.artist}|||${c.album}`
    if (counts[key]) {
      if (!counts[key].cover_url && c.cover_url) counts[key].cover_url = c.cover_url
      if (!counts[key].genre && c.genre) counts[key].genre = c.genre
    }
  }
  return Object.values(counts).sort((a, b) => b.plays - a.plays)
}

function computeArtistStats(spins: Spin[]): ArtistStat[] {
  const counts: Record<string, { artist: string; plays: number; albums: Set<string>; genre: string; lastPlayed: string | null }> = {}
  for (const s of spins) {
    if (!counts[s.artist]) {
      counts[s.artist] = { artist: s.artist, plays: 0, albums: new Set(), genre: s.genre || '', lastPlayed: null }
    }
    counts[s.artist].plays++
    counts[s.artist].albums.add(s.album)
    if (!counts[s.artist].lastPlayed || s.date_played > counts[s.artist].lastPlayed!) {
      counts[s.artist].lastPlayed = s.date_played
    }
  }
  return Object.values(counts)
    .map(a => ({ ...a, albumCount: a.albums.size }))
    .sort((a, b) => b.plays - a.plays)
}

function computeDailyStats(spins: Spin[]): DailyStats {
  const days: DailyStats = {}
  for (const s of spins) {
    const d = s.date_played?.substring(0, 10)
    if (!d) continue
    if (!days[d]) days[d] = { date: d, plays: 0, albums: [] }
    days[d].plays++
    days[d].albums.push({ artist: s.artist, album: s.album })
  }
  return days
}

// ── Bubble Universe ───────────────────────────────────────────────────────────

interface BubbleNode extends d3.SimulationNodeDatum, AlbumStat {
  r: number
}

function BubbleUniverse({ data }: { data: AlbumStat[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useEffect(() => {
    if (!data?.length || !svgRef.current) return

    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const top200 = data.slice(0, 200)
    const maxPlays = d3.max(top200, d => d.plays) ?? 1
    const r = d3.scaleSqrt().domain([1, maxPlays]).range([8, 50])

    const genres = [...new Set(top200.map(d => d.genre || 'Other'))]
    const clusterCentres: Record<string, { x: number; y: number }> = {}
    genres.forEach((g, i) => {
      const angle = (i / genres.length) * 2 * Math.PI
      clusterCentres[g] = {
        x: width / 2 + (width * 0.32) * Math.cos(angle),
        y: height / 2 + (height * 0.32) * Math.sin(angle),
      }
    })

    const nodes: BubbleNode[] = top200.map(d => ({
      ...d,
      r: r(d.plays),
      x: width / 2 + (Math.random() - 0.5) * 100,
      y: height / 2 + (Math.random() - 0.5) * 100,
    }))

    const simulation = d3.forceSimulation(nodes)
      .force('collide', d3.forceCollide<BubbleNode>(d => d.r + 2).strength(0.8))
      .force('x', d3.forceX<BubbleNode>(d => clusterCentres[d.genre || 'Other']?.x ?? width / 2).strength(0.06))
      .force('y', d3.forceY<BubbleNode>(d => clusterCentres[d.genre || 'Other']?.y ?? height / 2).strength(0.06))
      .force('charge', d3.forceManyBody().strength(-5))

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 5])
      .on('zoom', e => g.attr('transform', e.transform))
    svg.call(zoom)

    const g = svg.append('g')

    genres.forEach(genre => {
      const centre = clusterCentres[genre]
      if (!centre) return
      g.append('text')
        .attr('x', centre.x).attr('y', centre.y)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .attr('font-size', 11).attr('font-family', 'system-ui, sans-serif')
        .attr('letter-spacing', 1.5).attr('fill', getGenreColour(genre))
        .attr('opacity', 0.4).text(genre.toUpperCase())
    })

    const circles = g.selectAll<SVGCircleElement, BubbleNode>('circle')
      .data(nodes).enter().append('circle')
      .attr('r', d => d.r)
      .attr('fill', d => getGenreColour(d.genre))
      .attr('fill-opacity', 0.75)
      .attr('stroke', d => getGenreColour(d.genre))
      .attr('stroke-opacity', 0.9)
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .call(d3.drag<SVGCircleElement, BubbleNode>()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null })
      )
      .on('mouseover', (e: MouseEvent, d) => {
        d3.select(e.currentTarget as SVGCircleElement).attr('fill-opacity', 1).attr('stroke-width', 2.5)
        setTooltip({ x: e.clientX, y: e.clientY, data: d })
      })
      .on('mousemove', (e: MouseEvent) => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null))
      .on('mouseout', (e: MouseEvent) => {
        d3.select(e.currentTarget as SVGCircleElement).attr('fill-opacity', 0.75).attr('stroke-width', 1.5)
        setTooltip(null)
      })

    const labels = g.selectAll<SVGTextElement, BubbleNode>('text.bubble-label')
      .data(nodes.filter(d => d.r > 24)).enter()
      .append('text').attr('class', 'bubble-label')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', '#ede5d8').attr('fill-opacity', 0.9)
      .attr('font-size', d => Math.max(8, d.r / 4))
      .attr('font-family', 'system-ui, sans-serif')
      .style('pointer-events', 'none')
      .text(d => d.album.length > 20 ? d.album.substring(0, 18) + '…' : d.album)

    simulation.on('tick', () => {
      circles.attr('cx', d => d.x ?? 0).attr('cy', d => d.y ?? 0)
      labels.attr('x', d => d.x ?? 0).attr('y', d => d.y ?? 0)
    })

    return () => { simulation.stop() }
  }, [data])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', background: 'transparent' }} />
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10,
          background: '#1a1a1a', border: '1px solid rgba(232,220,200,0.2)',
          padding: '8px 12px', borderRadius: 3, fontSize: 13, pointerEvents: 'none', zIndex: 1000, maxWidth: 220,
        }}>
          <div style={{ fontWeight: 500, color: '#ede5d8' }}>{(tooltip.data as AlbumStat).album}</div>
          <div style={{ color: 'rgba(232,220,200,0.6)', marginTop: 2 }}>{tooltip.data.artist}</div>
          <div style={{ color: '#c45e3a', marginTop: 4, fontSize: 12 }}>
            {tooltip.data.plays} {tooltip.data.plays === 1 ? 'play' : 'plays'}
          </div>
          {tooltip.data.genre && (
            <div style={{ color: getGenreColour(tooltip.data.genre), fontSize: 11, marginTop: 2 }}>
              {tooltip.data.genre}
            </div>
          )}
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, color: 'rgba(232,220,200,0.3)', fontFamily: 'system-ui, sans-serif' }}>
        Drag bubbles · Scroll to zoom · Hover for detail
      </div>
    </div>
  )
}

// ── Vinyl Galaxy ──────────────────────────────────────────────────────────────

function VinylGalaxy({ data }: { data: AlbumStat[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: AlbumStat } | null>(null)

  useEffect(() => {
    if (!data?.length || !svgRef.current) return

    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    let cancelled = false

    const defs = svg.append('defs')

    const starGroup = svg.append('g').attr('class', 'stars')
    for (let i = 0; i < 200; i++) {
      const size = Math.random() * 1.5 + 0.5
      starGroup.append('circle')
        .attr('cx', Math.random() * width).attr('cy', Math.random() * height)
        .attr('r', size).attr('fill', 'white').attr('opacity', Math.random() * 0.6 + 0.1)
    }

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 8]).on('zoom', e => g.attr('transform', e.transform))
    svg.call(zoom)

    const g = svg.append('g')

    const genreGroups: Record<string, AlbumStat[]> = {}
    for (const d of data) {
      const genre = d.genre || 'Other'
      if (!genreGroups[genre]) genreGroups[genre] = []
      genreGroups[genre].push(d)
    }

    const genres = Object.keys(genreGroups)
    const maxPlays = d3.max(data, d => d.plays) ?? 1
    const planetR = d3.scaleSqrt().domain([1, maxPlays]).range([4, 20])

    const sunPositions: Record<string, { x: number; y: number; colour: string }> = {}
    const padding = 120
    genres.forEach((genre, i) => {
      const angle = (i / genres.length) * 2 * Math.PI - Math.PI / 2
      const rx = (width / 2 - padding) * 0.75
      const ry = (height / 2 - padding) * 0.75
      sunPositions[genre] = {
        x: width / 2 + rx * Math.cos(angle),
        y: height / 2 + ry * Math.sin(angle),
        colour: getGenreColour(genre),
      }
    })

    const sunSize = 18
    for (const [genre, pos] of Object.entries(sunPositions)) {
      const filterId = `glow-${genre.replace(/[^a-z]/gi, '')}`
      const filter = defs.append('filter').attr('id', filterId)
      filter.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'blur')
      const feMerge = filter.append('feMerge')
      feMerge.append('feMergeNode').attr('in', 'blur')
      feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

      g.append('circle').attr('cx', pos.x).attr('cy', pos.y)
        .attr('r', sunSize * 1.8).attr('fill', pos.colour).attr('opacity', 0.1)

      g.append('circle').attr('cx', pos.x).attr('cy', pos.y)
        .attr('r', sunSize).attr('fill', pos.colour).attr('opacity', 0.85)
        .attr('filter', `url(#${filterId})`)

      g.append('text').attr('x', pos.x).attr('y', pos.y + sunSize + 14)
        .attr('text-anchor', 'middle').attr('fill', pos.colour)
        .attr('font-size', 10).attr('font-family', 'system-ui, sans-serif')
        .attr('letter-spacing', 1.5).attr('opacity', 0.7).text(genre.toUpperCase())

      const albums = genreGroups[genre]
      const numOrbits = Math.ceil(albums.length / 6)
      const baseOrbit = 45
      for (let i = 0; i < numOrbits; i++) {
        g.append('circle').attr('cx', pos.x).attr('cy', pos.y)
          .attr('r', baseOrbit + i * 28).attr('fill', 'none')
          .attr('stroke', pos.colour).attr('stroke-opacity', 0.08).attr('stroke-width', 1)
      }

      albums.forEach((album, j) => {
        const orbitIdx = Math.floor(j / 6)
        const orbitR = baseOrbit + orbitIdx * 28
        const angleOffset = (j % 6) / 6 * 2 * Math.PI
        const speed = 0.00008 + orbitIdx * 0.00003

        const planetGroup = g.append('g').style('cursor', 'pointer')
          .on('mouseover', (e: MouseEvent) => setTooltip({ x: e.clientX, y: e.clientY, data: album }))
          .on('mousemove', (e: MouseEvent) => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null))
          .on('mouseout', () => setTooltip(null))

        planetGroup.append('circle')
          .attr('r', planetR(album.plays))
          .attr('fill', pos.colour).attr('fill-opacity', 0.8)
          .attr('stroke', pos.colour).attr('stroke-opacity', 0.9).attr('stroke-width', 1)

        function orbit(timestamp: number) {
          if (cancelled) return
          const angle = angleOffset + timestamp * speed
          const x = pos.x + orbitR * Math.cos(angle)
          const y = pos.y + orbitR * Math.sin(angle)
          planetGroup.attr('transform', `translate(${x}, ${y})`)
          requestAnimationFrame(orbit)
        }
        requestAnimationFrame(orbit)
      })
    }

    return () => { cancelled = true }
  }, [data])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', background: '#050508' }} />
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10,
          background: '#0d0d14', border: '1px solid rgba(232,220,200,0.2)',
          padding: '8px 12px', borderRadius: 3, fontSize: 13, pointerEvents: 'none', zIndex: 1000,
        }}>
          <div style={{ fontWeight: 500, color: '#ede5d8' }}>{tooltip.data.album}</div>
          <div style={{ color: 'rgba(232,220,200,0.6)', marginTop: 2 }}>{tooltip.data.artist}</div>
          <div style={{ color: '#c45e3a', marginTop: 4, fontSize: 12 }}>
            {tooltip.data.plays} {tooltip.data.plays === 1 ? 'play' : 'plays'}
          </div>
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, color: 'rgba(232,220,200,0.3)', fontFamily: 'system-ui, sans-serif' }}>
        Hover planets · Scroll to zoom · Click for detail
      </div>
    </div>
  )
}

// ── Listening Heatmap ─────────────────────────────────────────────────────────

function ListeningHeatmap({ data }: { data: DailyStats }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selectedDay, setSelectedDay] = useState<DayStat | null>(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  const years = [...new Set(
    Object.keys(data).map(d => parseInt(d.substring(0, 4)))
  )].sort((a, b) => b - a)

  // Default to most recent year with data
  useEffect(() => {
    if (years.length > 0 && !years.includes(selectedYear)) {
      setSelectedYear(years[0])
    }
  }, [years, selectedYear])

  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const cellSize = 14
    const cellGap = 2
    const cellStep = cellSize + cellGap
    const weekdays = ['', 'Mon', '', 'Wed', '', 'Fri', '']
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    const leftPad = 32
    const topPad = 30

    const maxPlays = d3.max(Object.values(data), d => d.plays) ?? 1
    const colour = d3.scaleSequential()
      .domain([0, maxPlays])
      .interpolator((t: number) => {
        if (t === 0) return 'rgba(232,220,200,0.06)'
        return d3.interpolate('#2a1a10', '#c45e3a')(t)
      })

    const g = svg.append('g').attr('transform', `translate(${leftPad}, ${topPad})`)

    weekdays.forEach((d, i) => {
      if (!d) return
      g.append('text')
        .attr('x', -6).attr('y', i * cellStep + cellSize * 0.85)
        .attr('text-anchor', 'end').attr('font-size', 9)
        .attr('font-family', 'system-ui, sans-serif')
        .attr('fill', 'rgba(232,220,200,0.35)').text(d)
    })

    const allDays = d3.timeDays(new Date(selectedYear, 0, 1), new Date(selectedYear + 1, 0, 1))

    const weeks = d3.timeWeeks(
      d3.timeWeek.floor(new Date(selectedYear, 0, 1)),
      new Date(selectedYear + 1, 0, 1)
    )

    let lastMonth = -1
    weeks.forEach((week, wi) => {
      const d = new Date(week)
      d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7))
      const month = d.getMonth()
      if (month !== lastMonth && d.getFullYear() === selectedYear) {
        g.append('text')
          .attr('x', wi * cellStep).attr('y', -8)
          .attr('font-size', 10).attr('font-family', 'system-ui, sans-serif')
          .attr('fill', 'rgba(232,220,200,0.5)').text(months[month])
        lastMonth = month
      }
    })

    allDays.forEach(date => {
      const dateStr = date.toISOString().substring(0, 10)
      const dow = (date.getDay() + 6) % 7
      const week = d3.timeWeek.count(d3.timeYear(date), date)
      const dayData = data[dateStr]
      const plays = dayData?.plays || 0

      g.append('rect')
        .attr('x', week * cellStep).attr('y', dow * cellStep)
        .attr('width', cellSize).attr('height', cellSize)
        .attr('rx', 2).attr('fill', colour(plays))
        .style('cursor', plays > 0 ? 'pointer' : 'default')
        .on('click', () => { if (plays > 0) setSelectedDay(dayData) })
        .on('mouseover', function () {
          if (plays > 0) d3.select(this).attr('stroke', '#c45e3a').attr('stroke-width', 1.5)
        })
        .on('mouseout', function () {
          d3.select(this).attr('stroke', 'none')
        })
    })

    const legendG = svg.append('g').attr('transform', `translate(${leftPad}, ${topPad + 7 * cellStep + 20})`)
    legendG.append('text').attr('x', 0).attr('y', 10).attr('font-size', 10).attr('fill', 'rgba(232,220,200,0.4)').attr('font-family', 'system-ui, sans-serif').text('Less');
    [0, 0.25, 0.5, 0.75, 1].forEach((t, i) => {
      legendG.append('rect')
        .attr('x', 32 + i * (cellSize + 2)).attr('y', 0)
        .attr('width', cellSize).attr('height', cellSize)
        .attr('rx', 2).attr('fill', colour(t * maxPlays))
    })
    legendG.append('text').attr('x', 32 + 5 * (cellSize + 2) + 4).attr('y', 10).attr('font-size', 10).attr('fill', 'rgba(232,220,200,0.4)').attr('font-family', 'system-ui, sans-serif').text('More')

  }, [data, selectedYear])

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {years.map(y => (
          <button key={y} onClick={() => setSelectedYear(y)} style={{
            background: selectedYear === y ? 'rgba(196,94,58,0.15)' : 'transparent',
            color: selectedYear === y ? '#c45e3a' : 'rgba(232,220,200,0.45)',
            border: `1px solid ${selectedYear === y ? '#c45e3a' : 'rgba(232,220,200,0.12)'}`,
            padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
          }}>
            {y}
          </button>
        ))}
      </div>

      <svg ref={svgRef} style={{ width: '100%', height: 180 }} />

      {selectedDay && (
        <div style={{
          marginTop: 20, background: 'rgba(232,220,200,0.03)',
          border: '1px solid rgba(232,220,200,0.1)', padding: 16, borderRadius: 2,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'rgba(232,220,200,0.6)' }}>
              {new Date(selectedDay.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              <span style={{ color: '#c45e3a', marginLeft: 8 }}>{selectedDay.plays} {selectedDay.plays === 1 ? 'play' : 'plays'}</span>
            </div>
            <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', color: 'rgba(232,220,200,0.4)', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selectedDay.albums.map((a, i) => (
              <div key={i} style={{ fontSize: 14, display: 'flex', gap: 8 }}>
                <span style={{ color: 'rgba(232,220,200,0.4)', fontFamily: 'monospace', fontSize: 11, minWidth: 20, paddingTop: 2 }}>{i + 1}</span>
                <span><span style={{ fontStyle: 'italic' }}>{a.album}</span> <span style={{ color: 'rgba(232,220,200,0.5)' }}>— {a.artist}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Constellation Map ─────────────────────────────────────────────────────────

interface StarNode extends d3.SimulationNodeDatum {
  artist: string
  plays: number
  albumCount: number
  genre: string
  lastPlayed: string | null
  recency: number
}

interface StarLink extends d3.SimulationLinkDatum<StarNode> {
  count: number
}

function ConstellationMap({ data, spins }: { data: ArtistStat[]; spins: Spin[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: StarNode } | null>(null)

  useEffect(() => {
    if (!data?.length || !svgRef.current) return

    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const bg = svg.append('g')
    for (let i = 0; i < 300; i++) {
      bg.append('circle')
        .attr('cx', Math.random() * width).attr('cy', Math.random() * height)
        .attr('r', Math.random() * 1.2 + 0.3).attr('fill', 'white')
        .attr('opacity', Math.random() * 0.4 + 0.05)
    }

    const sortedSpins = [...spins].sort((a, b) => (a.date_played ?? '').localeCompare(b.date_played ?? ''))
    const connections: Record<string, number> = {}
    for (let i = 0; i < sortedSpins.length - 1; i++) {
      const a = sortedSpins[i]
      const b = sortedSpins[i + 1]
      if (!a.date_played || !b.date_played) continue
      const daysDiff = Math.abs(new Date(a.date_played).getTime() - new Date(b.date_played).getTime()) / (1000 * 60 * 60 * 24)
      if (daysDiff <= 3 && a.artist !== b.artist) {
        const key = [a.artist, b.artist].sort().join('|||')
        connections[key] = (connections[key] || 0) + 1
      }
    }

    const today = new Date()
    const nodes: StarNode[] = data.slice(0, 80).map(d => {
      const daysSince = d.lastPlayed
        ? (today.getTime() - new Date(d.lastPlayed).getTime()) / (1000 * 60 * 60 * 24)
        : 365
      const recency = Math.max(0, 1 - daysSince / 180)
      return { ...d, recency }
    })

    const nodeMap: Record<string, StarNode> = {}
    nodes.forEach(n => { nodeMap[n.artist] = n })

    const links: StarLink[] = Object.entries(connections)
      .filter(([key]) => {
        const [a, b] = key.split('|||')
        return nodeMap[a] && nodeMap[b]
      })
      .map(([key, count]) => {
        const [source, target] = key.split('|||')
        return { source, target, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 150)

    const maxPlays = d3.max(nodes, d => d.plays) ?? 1
    const starR = d3.scaleSqrt().domain([1, maxPlays]).range([3, 18])

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 8]).on('zoom', e => g.attr('transform', e.transform))
    svg.call(zoom)

    const g = svg.append('g')

    const simulation = d3.forceSimulation<StarNode>(nodes)
      .force('link', d3.forceLink<StarNode, StarLink>(links).id(d => d.artist).distance(80).strength(d => Math.min(0.3, d.count * 0.05)))
      .force('charge', d3.forceManyBody().strength(-60))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<StarNode>(d => starR(d.plays) + 8))

    const lineG = g.append('g').attr('class', 'links')
    const line = lineG.selectAll<SVGLineElement, StarLink>('line')
      .data(links).enter().append('line')
      .attr('stroke', 'rgba(232,220,200,0.08)')
      .attr('stroke-width', d => Math.min(2, d.count * 0.3))

    const defs = svg.append('defs')
    const glowFilter = defs.append('filter').attr('id', 'star-glow')
    glowFilter.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'blur')
    const feMerge = glowFilter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'blur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    const starG = g.append('g').attr('class', 'stars-artists')

    const stars = starG.selectAll<SVGGElement, StarNode>('g.star')
      .data(nodes).enter().append('g').attr('class', 'star')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, StarNode>()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null })
      )
      .on('mouseover', (e: MouseEvent, d) => {
        setTooltip({ x: e.clientX, y: e.clientY, data: d })
        line
          .attr('stroke', (l: StarLink) => {
            const src = typeof l.source === 'object' ? (l.source as StarNode).artist : l.source
            const tgt = typeof l.target === 'object' ? (l.target as StarNode).artist : l.target
            return (src === d.artist || tgt === d.artist) ? 'rgba(196,94,58,0.5)' : 'rgba(232,220,200,0.06)'
          })
          .attr('stroke-width', (l: StarLink) => {
            const src = typeof l.source === 'object' ? (l.source as StarNode).artist : l.source
            const tgt = typeof l.target === 'object' ? (l.target as StarNode).artist : l.target
            return (src === d.artist || tgt === d.artist) ? 1.5 : Math.min(2, l.count * 0.3)
          })
      })
      .on('mousemove', (e: MouseEvent) => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null))
      .on('mouseout', () => {
        setTooltip(null)
        line.attr('stroke', 'rgba(232,220,200,0.08)').attr('stroke-width', (d: StarLink) => Math.min(2, d.count * 0.3))
      })

    stars.append('circle')
      .attr('r', d => starR(d.plays) * 1.8)
      .attr('fill', d => getGenreColour(d.genre))
      .attr('opacity', d => d.recency * 0.25)
      .attr('filter', 'url(#star-glow)')

    stars.append('circle')
      .attr('r', d => starR(d.plays))
      .attr('fill', d => getGenreColour(d.genre))
      .attr('opacity', d => 0.6 + d.recency * 0.4)

    stars.filter(d => d.plays >= 5)
      .append('text')
      .attr('y', d => starR(d.plays) + 10)
      .attr('text-anchor', 'middle').attr('font-size', 9)
      .attr('font-family', 'system-ui, sans-serif')
      .attr('fill', 'rgba(232,220,200,0.6)')
      .style('pointer-events', 'none')
      .text(d => d.artist)

    simulation.on('tick', () => {
      line
        .attr('x1', (d: StarLink) => (d.source as StarNode).x ?? 0)
        .attr('y1', (d: StarLink) => (d.source as StarNode).y ?? 0)
        .attr('x2', (d: StarLink) => (d.target as StarNode).x ?? 0)
        .attr('y2', (d: StarLink) => (d.target as StarNode).y ?? 0)
      stars.attr('transform', d => `translate(${d.x ?? 0}, ${d.y ?? 0})`)
    })

    return () => { simulation.stop() }
  }, [data, spins])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', background: '#030306' }} />
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10,
          background: '#0a0a12', border: '1px solid rgba(232,220,200,0.2)',
          padding: '8px 12px', borderRadius: 3, fontSize: 13, pointerEvents: 'none', zIndex: 1000,
        }}>
          <div style={{ fontWeight: 500, color: '#ede5d8' }}>{tooltip.data.artist}</div>
          <div style={{ color: 'rgba(232,220,200,0.5)', marginTop: 2, fontSize: 12 }}>
            {tooltip.data.albumCount} album{tooltip.data.albumCount !== 1 ? 's' : ''}
          </div>
          <div style={{ color: '#c45e3a', marginTop: 4, fontSize: 12 }}>
            {tooltip.data.plays} {tooltip.data.plays === 1 ? 'play' : 'plays'}
          </div>
          {tooltip.data.genre && (
            <div style={{ color: getGenreColour(tooltip.data.genre), fontSize: 11, marginTop: 2 }}>
              {tooltip.data.genre}
            </div>
          )}
          {tooltip.data.recency > 0.5 && (
            <div style={{ color: 'rgba(107,168,154,0.8)', fontSize: 11, marginTop: 2 }}>
              ● Recently played
            </div>
          )}
        </div>
      )}
      <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 11, color: 'rgba(232,220,200,0.3)', fontFamily: 'system-ui, sans-serif', textAlign: 'right' }}>
        <div>★ = artist · Size = plays</div>
        <div>Brightness = recent plays</div>
        <div>Lines = played near each other</div>
      </div>
      <div style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, color: 'rgba(232,220,200,0.3)', fontFamily: 'system-ui, sans-serif' }}>
        Hover stars · Scroll to zoom · Drag
      </div>
    </div>
  )
}

// ── Mode toggle ───────────────────────────────────────────────────────────────

const MODES = [
  { id: 'bubbles', label: 'Bubble Universe', icon: '⬤' },
  { id: 'galaxy', label: 'Vinyl Galaxy', icon: '✦' },
  { id: 'heatmap', label: 'Heatmap', icon: '▦' },
  { id: 'constellation', label: 'Constellations', icon: '★' },
] as const

type Mode = typeof MODES[number]['id']

// ── Main VisualiserTab ────────────────────────────────────────────────────────

export default function VisualiserTab({ username }: { username: string }) {
  const [mode, setMode] = useState<Mode>('bubbles')
  const [albumStats, setAlbumStats] = useState<AlbumStat[]>([])
  const [artistStats, setArtistStats] = useState<ArtistStat[]>([])
  const [dailyStats, setDailyStats] = useState<DailyStats>({})
  const [spins, setSpins] = useState<Spin[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('spins').select('*').eq('username', username),
      supabase.from('collection').select('*').eq('username', username),
    ]).then(([s, c]) => {
      const spinsData = (s.data || []) as Spin[]
      const collectionData = (c.data || []) as Collection[]
      setSpins(spinsData)
      setAlbumStats(computeAlbumStats(spinsData, collectionData))
      setArtistStats(computeArtistStats(spinsData))
      setDailyStats(computeDailyStats(spinsData))
      setLoading(false)
    })
  }, [username])

  if (loading) return <p className="text-cream-dim text-sm">Loading visualiser…</p>

  if (!spins.length) {
    return <p className="text-cream-dim text-sm">No spins logged yet — start playing some records.</p>
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            style={{
              background: mode === m.id ? 'rgba(196,94,58,0.15)' : 'transparent',
              color: mode === m.id ? '#c45e3a' : 'rgba(232,220,200,0.45)',
              border: `1px solid ${mode === m.id ? '#c45e3a' : 'rgba(232,220,200,0.12)'}`,
              padding: '8px 16px', fontSize: 12, fontFamily: 'system-ui, sans-serif',
              letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      <div style={{ width: '100%', height: 600, position: 'relative' }}>
        {mode === 'bubbles' && <BubbleUniverse data={albumStats} />}
        {mode === 'galaxy' && <VinylGalaxy data={albumStats} />}
        {mode === 'heatmap' && <ListeningHeatmap data={dailyStats} />}
        {mode === 'constellation' && <ConstellationMap data={artistStats} spins={spins} />}
      </div>
    </div>
  )
}
