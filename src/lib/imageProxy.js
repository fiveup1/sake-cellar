/**
 * Wrap external image URLs through our proxy to avoid CORS/hotlink issues.
 * Supabase storage URLs are passed through directly.
 */
export function proxyImage(url) {
  if (!url) return null
  // Already a proxy URL
  if (url.startsWith('/api/image-proxy')) return url
  // Supabase storage - no proxy needed (various URL formats)
  if (url.includes('supabase.co')) return url
  if (url.includes('supabase.in')) return url
  // Local/relative URLs - no proxy needed
  if (url.startsWith('/') || url.startsWith('blob:') || url.startsWith('data:')) return url
  // Wrap all other external URLs
  return `/api/image-proxy?url=${encodeURIComponent(url)}`
}
