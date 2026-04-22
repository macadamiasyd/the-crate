export type CoverSource = 'musicbrainz' | 'itunes' | 'discogs' | 'user_picked' | 'manual_upload' | null

export interface Spin {
  id: string
  username: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  format: string | null
  cover_url: string | null
  cover_source: CoverSource
  mbid: string | null
  date_played: string
  created_at: string
}

export type NotesSource = 'wikipedia' | 'lastfm' | 'discogs' | 'manual' | null

export interface Collection {
  id: string
  username: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  format: string | null
  cover_url: string | null
  cover_source: CoverSource
  mbid: string | null
  notes: string | null
  notes_text: string | null
  notes_source: NotesSource
  credits: string | null
  created_at: string
}

export type Wishlist = Collection

export interface CoverSearchResult {
  url: string
  source: string
  mbid?: string | null
  title?: string
  artist?: string
  year?: string
  format?: string
}
