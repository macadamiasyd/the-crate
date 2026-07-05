// src/lib/normalise.ts

// Known alias pairs — canonical (collection) name first, alternate second
const ALIASES: [string, string][] = [
  ['Four Tet', 'FourTet'],
  ['Gil Scott-Heron', 'Gil Scott Heron'],
  ['Gil Scott-Heron', 'Gil Scott-Heron & Brian Jackson'],
  ['Earth, Wind & Fire', 'Earth Wind & Fire'],
  ['Earth, Wind & Fire', 'EWF'],
]

/** Lowercase, strip punctuation and extra whitespace */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Resolve an alternate name to its canonical form (or return as-is) */
export function resolveAlias(name: string): string {
  const n = normalise(name)
  for (const [canonical, alternate] of ALIASES) {
    if (normalise(alternate) === n) return canonical
  }
  return name
}

/** True if two names match after normalisation (including alias resolution) */
export function namesMatch(a: string, b: string): boolean {
  return normalise(resolveAlias(a)) === normalise(resolveAlias(b))
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
 * Returns the matched row (so the caller can snap to canonical names/metadata),
 * or null if no match.
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
