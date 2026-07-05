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
  // Discogs enrichment
  discogs_release_id: number | null
  discogs_instance_id: number | null
  label: string | null
  catno: string | null
  styles: string[] | null
  lowest_price: number | null
  num_for_sale: number | null
  value_updated_at: string | null
  discogs_synced_at: string | null
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

export interface DiscogsSearchResult {
  id: number
  artist: string
  title: string
  year: string | null
  label: string | null
  catno: string | null
  cover_url: string | null
}
