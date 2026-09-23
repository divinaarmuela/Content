/**
 * Pure Gmail message-parsing logic — no imports, unit-testable.
 * The server client (gmail.ts) composes these with the Gmail REST API.
 */

export type GmailHeader = { name: string; value: string }
export type GmailPart = {
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { data?: string; size?: number; attachmentId?: string }
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

/** the text/html part as sent, for the conversation page to draw — null when the message has none */
export function extractHtml(payload: GmailPayload): string | null {
  const html = findPart(payload, 'text/html')
  return html ? decodeBase64Url(html) : null
}

/* ── INLINE IMAGES (research, 23 Sep 2026: an HTML signature's icons are attachments the message carries itself,
   referenced as src="cid:<Content-ID>" inside a multipart/related body; Gmail resolves each cid to the attachment
   part when it draws the mail, a browser cannot, so the frame showed a broken icon with the alt text — the raw link).
   The parts are listed here (pure); gmail.ts fetches each attachment and the html is rewritten to data: URLs. ── */

export type InlineImagePart = { cid: string; mimeType: string; attachmentId: string | null; data: string | null; size: number }

/** every image part with a Content-ID (or Gmail's X-Attachment-Id), cid without its angle brackets */
export function inlineImageParts(payload: GmailPart): InlineImagePart[] {
  const out: InlineImagePart[] = []
  const walk = (part: GmailPart) => {
    const mime = String(part.mimeType ?? '').toLowerCase()
    const cidRaw = header(part.headers, 'Content-ID') || header(part.headers, 'X-Attachment-Id')
    if (mime.startsWith('image/') && cidRaw) {
      out.push({ cid: cidRaw.replace(/^<|>$/g, '').trim(), mimeType: mime, attachmentId: part.body?.attachmentId ?? null, data: part.body?.data ?? null, size: part.body?.size ?? 0 })
    }
    for (const p of part.parts ?? []) walk(p)
  }
  walk(payload)
  return out
}

/** base64url (as Gmail returns it) to a data: URL */
export function dataUrlFromBase64Url(mimeType: string, base64url: string): string {
  return `data:${mimeType};base64,${base64url.replace(/-/g, '+').replace(/_/g, '/')}`
}

/** src="cid:…" swapped for the image itself; an image nobody could fetch is removed whole, never drawn broken */
export function inlineCidImages(html: string, resolved: ReadonlyMap<string, string>): string {
  return html
    .replace(/<img\b[^>]*>/gi, tag => {
      const m = /\ssrc\s*=\s*(["']?)cid:([^"'\s>]+)\1/i.exec(tag)
      if (!m) return tag
      const cid = decodeURIComponent(m[2]).replace(/^<|>$/g, '')
      const url = resolved.get(cid) ?? resolved.get(cid.toLowerCase())
      return url ? tag.replace(m[0], ` src="${url}"`) : ''
    })
}
