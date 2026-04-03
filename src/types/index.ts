export interface Spin {
  id: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  date_played: string
  created_at: string
}

export interface Collection {
  id: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  notes: string | null
  created_at: string
}

export type Wishlist = Collection
