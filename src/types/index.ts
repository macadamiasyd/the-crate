export interface Spin {
  id: string
  username: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  format: string | null
  cover_url: string | null
  mbid: string | null
  date_played: string
  created_at: string
}

export interface Collection {
  id: string
  username: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  format: string | null
  cover_url: string | null
  mbid: string | null
  notes: string | null
  created_at: string
}

export type Wishlist = Collection
