/** A bare domain ("mdmmarketing.com.au") becomes a working absolute link;
 *  whitespace-only input becomes null so the column stays clean. */
export function normaliseWebsite(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}
