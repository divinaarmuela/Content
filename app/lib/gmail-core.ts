/**
 * Pure Gmail message-parsing logic — no imports, unit-testable.
 * The server client (gmail.ts) composes these with the Gmail REST API.
 */

export type GmailHeader = { name: string; value: string }
export type GmailPart = {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}
export type GmailPayload = GmailPart & { headers?: GmailHeader[] }

/** Gmail returns base64url; decode to utf-8. */
export function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64').toString('utf-8')
}

/** Case-insensitive header lookup. */
export function header(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

/** "Jane Doe <jane@x.com>" → { name: "Jane Doe", email: "jane@x.com" } */
export function parseFromHeader(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/)
  if (m) return { name: (m[1] ?? '').trim(), email: m[2].trim().toLowerCase() }
  return { name: '', email: raw.trim().toLowerCase() }
}

/** Walk the MIME tree and return the best-effort plain text body.
 *  Prefers text/plain; falls back to stripped text/html. */
export function extractBody(payload: GmailPayload): string {
  const plain = findPart(payload, 'text/plain')
  if (plain) return decodeBase64Url(plain).trim()
  const html = findPart(payload, 'text/html')
  if (html) return stripHtml(decodeBase64Url(html)).trim()
  return ''
}

function findPart(part: GmailPart, mime: string): string | null {
  if (part.mimeType === mime && part.body?.data) return part.body.data
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime)
    if (found) return found
  }
  return null
}

/** Minimal HTML → text for classification purposes. */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(?=\s*\S)/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cheap pre-filter before spending a Claude call: obvious non-enquiries.
 *  Returns a skip reason, or null when the message deserves classification. */
export function prefilterSkipReason(input: {
  fromEmail: string
  subject: string
  ownDomain: string
  listUnsubscribe?: string
  autoSubmitted?: string
}): string | null {
  const from = input.fromEmail.toLowerCase()
  if (!from) return 'no sender'
  if (from.endsWith(`@${input.ownDomain}`)) return 'internal sender'
  if (/^(no-?reply|do-?not-?reply|noreply|notifications?|mailer-daemon|postmaster|bounce)@/i.test(from)) {
    return 'no-reply sender'
  }
  if (input.autoSubmitted && input.autoSubmitted.toLowerCase() !== 'no') return 'auto-submitted'
  if (input.listUnsubscribe) return 'bulk/newsletter'
  if (/\b(unsubscribe|newsletter)\b/i.test(input.subject)) return 'newsletter subject'
  return null
}
