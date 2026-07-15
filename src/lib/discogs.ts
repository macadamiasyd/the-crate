// src/lib/discogs.ts

const DISCOGS_BASE = 'https://api.discogs.com'
const USER_AGENT = 'TheCrateApp/1.0 +https://github.com/macadamiasyd/the-crate'

// Simple in-process throttle: track timestamp of last request
let lastRequestAt = 0

async function discogsGet<T>(path: string, retries = 3): Promise<T> {
  const token = process.env.DISCOGS_TOKEN
  if (!token) throw new Error('DISCOGS_TOKEN not set')

  const now = Date.now()
  const wait = Math.max(0, 1100 - (now - lastRequestAt))
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRequestAt = Date.now()

  const url = `${DISCOGS_BASE}${path}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Authorization': `Discogs token=${token}`,
    },
  })

  if (res.status === 429 && retries > 0) {
    const retryAfter = Math.min(parseInt(res.headers.get('Retry-After') ?? '5', 10), 10)
    await new Promise(r => setTimeout(r, (retryAfter + 1) * 1000))
    return discogsGet<T>(path, retries - 1)
  }

  if (!res.ok) throw new Error(`Discogs ${res.status} for ${path}`)
  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiscogsSearchResponse {
  results: Array<{
    id: number
    title: string           // "Artist Name - Album Title"
    year: string
    label: string[]
    catno: string
    cover_image: string
    community?: { have: number; want: number }
  }>
}

interface DiscogsReleaseResponse {
  id: number
  title: string
  year: number
  artists: Array<{ name: string }>
  labels: Array<{ name: string; catno: string }>
  genres: string[]
  styles: string[]
  lowest_price: number | null
  community: { have: number; want: number }
  images: Array<{ uri: string; type: string }>
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DiscogsMatch {
  releaseId: number
  artist: string
  title: string
  year: string | null
  label: string | null
  catno: string | null
  coverUrl: string | null
  styles: string[]
}

/**
 * Search Discogs for a vinyl release by artist and album title.
 * Returns the top result only (caller must verify names match).
 */
export async function searchRelease(artist: string, album: string): Promise<DiscogsMatch | null> {
  const base = { artist, release_title: album, type: 'release', per_page: '5' }

  // Try Vinyl first; fall back to any format, then to a freetext q= query
  let data = await discogsGet<DiscogsSearchResponse>(
    `/database/search?${new URLSearchParams({ ...base, format: 'Vinyl' })}`
  )
  if (!data.results?.length) {
    data = await discogsGet<DiscogsSearchResponse>(
      `/database/search?${new URLSearchParams(base)}`
    )
  }
  if (!data.results?.length) {
    data = await discogsGet<DiscogsSearchResponse>(
      `/database/search?${new URLSearchParams({ q: `${artist} ${album}`, type: 'release', per_page: '5' })}`
    )
  }

  if (!data.results?.length) return null

  const top = data.results[0]
  // Parse "Artist - Title" from the title field
  const dashIdx = top.title.indexOf(' - ')
  const parsedArtist = dashIdx > 0 ? top.title.substring(0, dashIdx) : ''
  const parsedTitle = dashIdx > 0 ? top.title.substring(dashIdx + 3) : top.title

  return {
    releaseId: top.id,
    artist: parsedArtist,
    title: parsedTitle,
    year: top.year || null,
    label: top.label?.[0] || null,
    catno: top.catno || null,
    coverUrl: top.cover_image || null,
    styles: [],
  }
}

/**
 * Fetch full release details including pricing and styles.
 */
export async function fetchRelease(releaseId: number): Promise<{
  lowestPrice: number | null
  numForSale: number
  styles: string[]
  coverUrl: string | null
  label: string | null
  catno: string | null
}> {
  const data = await discogsGet<DiscogsReleaseResponse>(`/releases/${releaseId}`)
  const primaryImage = data.images?.find(i => i.type === 'primary') ?? data.images?.[0]

  return {
    lowestPrice: data.lowest_price ?? null,
    numForSale: data.community?.have ?? 0,
    styles: data.styles ?? [],
    coverUrl: primaryImage?.uri ?? null,
    label: data.labels?.[0]?.name ?? null,
    catno: data.labels?.[0]?.catno ?? null,
  }
}
