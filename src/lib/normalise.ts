// src/lib/normalise.ts

// Known alias pairs — canonical (collection) name first, alternate second
const ALIASES: [string, string][] = [
  ['Four Tet', 'FourTet'],
  ['Gil Scott-Heron', 'Gil Scott Heron'],
  ['Gil Scott-Heron', 'Gil Scott-Heron & Brian Jackson'],
  ['Earth, Wind & Fire', 'Earth Wind & Fire'],
  ['Earth, Wind & Fire', 'EWF'],
  ['Talking Heads', 'Talkingheads'],
]

/** Lowercase, strip punctuation and extra whitespace */
export function normalise(s: string): string {
  // Coerce defensively: this sits on the critical path for logging, scanning,
  // the digest, the schedule and the never-logged dot, so a stray null from an
  // API or a DB row should degrade to "no match", never throw and blank a page.
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Deep normalise for fuzzy matching against Discogs data.
 * Handles: diacritics, asterisks, disambiguation numbers, trailing subtitles,
 * split-release suffixes, & vs and, leading articles.
 */
function deepNormalise(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // ö→o, é→e, ü→u, etc.
    .replace(/\s*\*\s*/g, ' ')             // Kinks* → Kinks
    .replace(/\s*\(\d+\)\s*/g, ' ')        // America (2) → America
    .replace(/\s+\/\s+.+$/, '')            // Title / Other Title → Title (split releases)
    .replace(/\s*\([^)]{0,60}\)\s*$/, '')  // strip trailing (Subtitle Text)
    .replace(/[-\u2013\u2014]/g, ' ')      // hyphens/en-dash/em-dash → space
    .replace(/\s+&\s+/g, ' and ')          // " & " → " and "
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')           // strip remaining punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')           // strip leading article
}

/** Resolve an alternate name to its canonical form (or return as-is) */
export function resolveAlias(name: string): string {
  const n = normalise(name)
  for (const [canonical, alternate] of ALIASES) {
    if (normalise(alternate) === n) return canonical
  }
  return name
}

/** True if two names match after deep normalisation (including alias resolution) */
export function namesMatch(a: string, b: string): boolean {
  const na = deepNormalise(resolveAlias(a))
  const nb = deepNormalise(resolveAlias(b))
  if (na === nb) return true

  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na]
  const wS = shorter.split(' ').length
  const wL = longer.split(' ').length

  // Word-prefix: "The Best Of" matches "The Best Of Blondie" (≤2 extra words)
  if (longer.startsWith(shorter + ' ') && wL - wS <= 2) return true

  // Substring: "Adventures Beyond The Ultraworld" inside "The Orb's Adventures Beyond…"
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.7) return true

  return false
}

export interface CollectionRow {
  artist: string
  album: string
  genre?: string | null
  year?: number | null
  cover_url?: string | null
  format?: string | null
}

/**
 * Find the best matching collection row for a given artist+album.
 */
export function matchCollection<T extends CollectionRow>(
  artist: string,
  album: string,
  collection: T[]
): T | null {
  for (const row of collection) {
    if (namesMatch(artist, row.artist) && namesMatch(album, row.album)) {
      return row
    }
  }
  return null
}
