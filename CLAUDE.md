# CLAUDE.md — The Crate

Personal vinyl log + collection manager. Owner: Joel Baldwin (`macadamiasyd`).
Sole user today; Phase 2 adds auth + multi-tenancy.

## Key constants
- JOEL_USER_ID = `2a73c466-83e3-4617-be7b-0b7b30468f14`
- Usernames are stored capitalised: `Joel`, `Ben`, `James`. Supabase `.eq()` is
  case-sensitive, so a wrong-cased literal returns zero rows **silently** — no error.
  Always match usernames with `.ilike()`. This has bitten three times (d14db39, 4168093).
- Model: `claude-sonnet-4-6` everywhere (Ask, photo ID, digest copy)

## Stack
- Next.js 16 App Router · Supabase Postgres · Anthropic API · Discogs API · Resend

## Hard rules
1. All external API calls server-side. `SUPABASE_SERVICE_ROLE_KEY` never reaches the client.
2. Discogs enrichment never deletes rows — unmatched rows are reported as skipped.
3. Normalisation lives in `lib/normalise.ts` only. Photo ID and Discogs both snap through it.
4. Discogs throttle: ≤1 req/1.1 s, custom User-Agent, backoff on 429.
5. Ask tool guard: SELECT/WITH only, single statement, allowlist spins|collection|v_unplayed, force LIMIT 200.

## Env vars (Vercel)
ANTHROPIC_API_KEY · NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY · DISCOGS_TOKEN · RESEND_API_KEY · DIGEST_TO · CRON_SECRET
SCHEDULE_EMAIL_TO (optional, falls back to DIGEST_TO) · SCHEDULE_EMAIL_FROM (optional)
ASK_LEGACY_CSV (optional, set to "true" to revert Ask to CSV dump)

## Removed features
Discogs price guide (`lowest_price` / `num_for_sale`) was removed 2026-08-03 — Discogs
low-ask is per-pressing-and-condition, and the collection records neither, so the numbers
were meaningless. DB columns are left in place but nothing reads or writes them.
