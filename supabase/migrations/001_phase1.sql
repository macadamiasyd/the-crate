-- supabase/migrations/001_phase1.sql
-- Phase 1: user_id columns, Discogs enrichment fields, v_unplayed view, exec_sql function

-- user_id: fixed UUID for sole user; Phase 2 swaps to auth.uid() + RLS
alter table spins      add column if not exists user_id uuid not null default '2a73c466-83e3-4617-be7b-0b7b30468f14';
alter table collection add column if not exists user_id uuid not null default '2a73c466-83e3-4617-be7b-0b7b30468f14';
create index if not exists idx_spins_user      on spins(user_id);
create index if not exists idx_collection_user on collection(user_id);

-- Discogs enrichment fields
alter table collection
  add column if not exists discogs_release_id  bigint,
  add column if not exists discogs_instance_id bigint,
  add column if not exists label               text,
  add column if not exists catno               text,
  add column if not exists styles              text[],
  add column if not exists lowest_price        numeric,
  add column if not exists num_for_sale        int,
  add column if not exists value_updated_at    timestamptz,
  add column if not exists discogs_synced_at   timestamptz;

-- v_unplayed: collection + last spin date per record (NULL last_played = never played)
create or replace view v_unplayed as
select
  c.*,
  max(s.date_played)                         as last_played,
  (current_date - max(s.date_played)::date)  as days_since_played
from collection c
left join spins s
  on lower(regexp_replace(s.artist, '[^a-z0-9]', '', 'gi')) =
     lower(regexp_replace(c.artist, '[^a-z0-9]', '', 'gi'))
 and lower(regexp_replace(s.album,  '[^a-z0-9]', '', 'gi')) =
     lower(regexp_replace(c.album,  '[^a-z0-9]', '', 'gi'))
 and s.username = c.username
group by c.id;

-- exec_sql: allows the Ask tool-use refactor to run arbitrary SELECT queries server-side
create or replace function exec_sql(query text)
returns json
language plpgsql
security definer
as $$
declare
  result json;
begin
  execute 'select json_agg(t) from (' || query || ') t' into result;
  return coalesce(result, '[]'::json);
end;
$$;
