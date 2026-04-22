import { NextRequest, NextResponse } from 'next/server'

const WP_UA = 'TheCrate/1.0 (hello@macadamia.com.au)'
const DISCOGS_UA = 'TheCrate/1.0'

function trimToLength(text: string, max: number): string {
  if (text.length <= max) return text
  return text.substring(0, max).replace(/\s\S*$/, '') + '…'
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fromWikipedia(artist: string, album: string): Promise<{ notes_text: string | null; notes_source: string | null }> {
  try {
    const q = encodeURIComponent(`${artist} ${album} album`)
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json&origin=*`
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': WP_UA } })
    if (!searchRes.ok) return { notes_text: null, notes_source: null }
    const searchData = await searchRes.json()

    const results: Array<{ title: string }> = searchData.query?.search || []
    if (!results.length) return { notes_text: null, notes_source: null }

    // Try results in order — prefer ones that look like album articles
    for (const result of results) {
      const title = encodeURIComponent(result.title)
      const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=extracts&exintro=false&explaintext=true&exsectionformat=plain&format=json&origin=*`
      const contentRes = await fetch(contentUrl, { headers: { 'User-Agent': WP_UA } })
      if (!contentRes.ok) continue
      const contentData = await contentRes.json()
      const pages = contentData.query?.pages
      const page = pages ? Object.values(pages)[0] as { extract?: string } : null
      if (!page?.extract || page.extract.length < 100) continue

      const fullText = page.extract
      // Split on section headers (Wikipedia plain text uses == Header == style)
      const sections = fullText.split(/\n(?===+\s)/)
      const intro = sections[0] || ''

      const relevantHeaders = ['background', 'recording', 'production', 'composition', 'music', 'writing', 'development', 'critical reception', 'legacy', 'history']
      const relevantSections = sections.slice(1).filter(s => {
        const header = s.split('\n')[0].toLowerCase().replace(/=+/g, '').trim()
        return relevantHeaders.some(h => header.includes(h))
      })

      let combined = intro.trim()
      for (const s of relevantSections) {
        if (combined.length >= 2500) break
        // Add section with its header stripped
        const body = s.split('\n').slice(1).join('\n').trim()
        if (body) combined += '\n\n' + body
      }

      combined = trimToLength(combined, 3000)
      if (combined.length > 100) {
        return { notes_text: combined, notes_source: 'wikipedia' }
      }
    }
  } catch (e) {
    console.error('Wikipedia error:', e)
  }
  return { notes_text: null, notes_source: null }
}

async function fromLastFm(artist: string, album: string): Promise<{ notes_text: string | null; notes_source: string | null }> {
  const key = process.env.LASTFM_API_KEY
  if (!key) return { notes_text: null, notes_source: null }
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&api_key=${key}&format=json`
    const res = await fetch(url)
    if (!res.ok) return { notes_text: null, notes_source: null }
    const data = await res.json()
    let wiki: string = data.album?.wiki?.content || ''
    if (!wiki) return { notes_text: null, notes_source: null }

    wiki = stripHtml(wiki)
      .replace(/\s*Read more on Last\.fm[\s\S]*$/, '')
      .trim()

    if (wiki.length > 50) {
      return { notes_text: trimToLength(wiki, 3000), notes_source: 'lastfm' }
    }
  } catch (e) {
    console.error('Last.fm error:', e)
  }
  return { notes_text: null, notes_source: null }
}

async function fromDiscogs(artist: string, album: string): Promise<{ notes_text: string | null; notes_source: string | null; credits: string | null }> {
  const token = process.env.DISCOGS_TOKEN
  if (!token) return { notes_text: null, notes_source: null, credits: null }

  try {
    const searchUrl = `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&type=release&per_page=3`
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': DISCOGS_UA },
    })
    if (!searchRes.ok) return { notes_text: null, notes_source: null, credits: null }
    const searchData = await searchRes.json()
    if (!searchData.results?.length) return { notes_text: null, notes_source: null, credits: null }

    const releaseUrl = searchData.results[0].resource_url
    const relRes = await fetch(releaseUrl, {
      headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': DISCOGS_UA },
    })
    if (!relRes.ok) return { notes_text: null, notes_source: null, credits: null }
    const release = await relRes.json()

    // Build credits
    const creditParts: string[] = []
    if (release.extraartists?.length) {
      const roles: Record<string, string[]> = {}
      for (const ea of release.extraartists) {
        const role = (ea.role || 'Other').replace(/\[.*?\]/g, '').trim()
        if (!roles[role]) roles[role] = []
        roles[role].push(ea.name)
      }
      for (const [role, names] of Object.entries(roles)) {
        creditParts.push(`${role}: ${names.join(', ')}`)
      }
    }
    if (release.labels?.length) {
      const l = release.labels[0]
      creditParts.push(`Label: ${l.name}${l.catno && l.catno !== 'none' ? ` (${l.catno})` : ''}`)
    }
    if (release.country) creditParts.push(`Country: ${release.country}`)

    let notes_text: string | null = null
    let notes_source: string | null = null

    if (release.notes?.length > 50) {
      const discogsNotes = stripHtml(release.notes)
      if (release.notes?.length > 50) {
        creditParts.push(`\nNotes:\n${discogsNotes}`)
      }
      // Use as fallback for notes_text too
      notes_text = trimToLength(discogsNotes, 3000)
      notes_source = 'discogs'
    }

    return {
      notes_text,
      notes_source,
      credits: creditParts.length > 0 ? creditParts.join('\n') : null,
    }
  } catch (e) {
    console.error('Discogs notes error:', e)
  }
  return { notes_text: null, notes_source: null, credits: null }
}

export async function POST(req: NextRequest) {
  try {
    const { artist, album } = await req.json()
    if (!artist || !album) {
      return NextResponse.json({ notes_text: null, notes_source: null, credits: null }, { status: 400 })
    }

    let notes_text: string | null = null
    let notes_source: string | null = null
    let credits: string | null = null

    // Step 1: Wikipedia (best quality, longest form)
    const wp = await fromWikipedia(artist, album)
    if (wp.notes_text) { notes_text = wp.notes_text; notes_source = wp.notes_source }

    // Step 2: Last.fm fallback
    if (!notes_text) {
      const lfm = await fromLastFm(artist, album)
      if (lfm.notes_text) { notes_text = lfm.notes_text; notes_source = lfm.notes_source }
    }

    // Step 3: Discogs — always try for credits; also fills notes_text as last resort
    const discogs = await fromDiscogs(artist, album)
    if (discogs.credits) credits = discogs.credits
    if (!notes_text && discogs.notes_text) { notes_text = discogs.notes_text; notes_source = discogs.notes_source }

    return NextResponse.json({ notes_text, notes_source, credits })
  } catch (error) {
    console.error('/api/lookup-notes error:', error)
    return NextResponse.json({ notes_text: null, notes_source: null, credits: null }, { status: 500 })
  }
}
