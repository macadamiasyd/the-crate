/**
 * Route external cover URLs through our caching proxy.
 * Supabase Storage URLs (manual uploads) are already on our domain — skip them.
 */
export function proxyCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null

  // Supabase Storage URLs are already ours — no need to proxy
  if (url.includes('supabase.co/storage/')) return url

  // Route external URLs through the caching proxy
  return `/api/cover-proxy?url=${encodeURIComponent(url)}`
}
