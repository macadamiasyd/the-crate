-- Run this in Supabase: Dashboard → SQL Editor → New Query

-- Spins table
CREATE TABLE IF NOT EXISTS public.spins (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username    TEXT NOT NULL DEFAULT 'Joel',
  artist      TEXT NOT NULL,
  album       TEXT NOT NULL,
  genre       TEXT,
  year        INTEGER,
  format      TEXT,
  date_played DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Collection table
CREATE TABLE IF NOT EXISTS public.collection (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username   TEXT NOT NULL DEFAULT 'Joel',
  artist     TEXT NOT NULL,
  album      TEXT NOT NULL,
  genre      TEXT,
  year       INTEGER,
  format     TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wishlist table
CREATE TABLE IF NOT EXISTS public.wishlist (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username   TEXT NOT NULL DEFAULT 'Joel',
  artist     TEXT NOT NULL,
  album      TEXT NOT NULL,
  genre      TEXT,
  year       INTEGER,
  format     TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.spins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;

-- Allow public read/write (personal app, no auth needed)
CREATE POLICY "public_spins" ON public.spins
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "public_collection" ON public.collection
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "public_wishlist" ON public.wishlist
  FOR ALL USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS spins_date_idx       ON public.spins (date_played DESC);
CREATE INDEX IF NOT EXISTS spins_artist_idx     ON public.spins (artist);
CREATE INDEX IF NOT EXISTS spins_username_idx   ON public.spins (username);
CREATE INDEX IF NOT EXISTS collection_artist_idx ON public.collection (artist);
CREATE INDEX IF NOT EXISTS collection_username_idx ON public.collection (username);
CREATE INDEX IF NOT EXISTS wishlist_artist_idx  ON public.wishlist (artist);
CREATE INDEX IF NOT EXISTS wishlist_username_idx ON public.wishlist (username);
