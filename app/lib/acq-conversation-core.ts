/**
 * A SCANNED MESSAGE'S CONVERSATION — the pure half (the owner, 23 Sep 2026:
 * "just create a page which shows the convo for that"). The Scanning view
 * lists what the email scanner read; this turns one of those rows plus the
 * Gmail thread it belongs to into the page: every message in order, who
 * wrote it and which way it went, and what the scanner decided. No I/O.
 */

import { INGEST_STATUS_WORDS } from './acq-scanning-core'

export type ThreadMessageLike = {
  id: string
  fromName?: string | null
  fromEmail?: string | null
  to?: string | null
  subject?: string | null
  at?: string | null
  body?: string | null
  html?: string | null
}

export type IngestRowLike = {
  id: string
  mailbox?: string | null
  from_email?: string | null
  subject?: string | null
  status?: string | null
  reasoning?: string | null
  confidence?: number | null
  received_at?: string | null
  created_at?: string | null
  lead_id?: string | null
  gmail_message_id?: string | null
}

export type ConversationMessage = {
  id: string
  who: string
  email: string
  to: string
  at: string | null
  body: string
  /** the HTML as sent, or null — the page sanitises it before drawing */
  html: string | null
  /** 'in' from outside, 'out' from the agency */
  direction: 'in' | 'out'
  /** the one the scanner read */
  scanned: boolean
}

export type Conversation = {
  subject: string
  mailbox: string
  decision: string
  reasoning: string | null
  confidence: number | null
  lead_id: string | null
  messages: ConversationMessage[]
}

export const AGENCY_DOMAIN = 'mdmmarketing.com.au'

/** which way a message went: from the agency's own domain is out, anything else is in */
export function directionOf(fromEmail: string | null | undefined): 'in' | 'out' {
  const domain = String(fromEmail ?? '').trim().toLowerCase().split('@')[1] ?? ''
  return domain === AGENCY_DOMAIN ? 'out' : 'in'
}

/** the page: the thread oldest first, the scanned message marked, and the scanner's verdict */
export function conversationView(row: IngestRowLike, thread: readonly ThreadMessageLike[]): Conversation {
  const messages = [...thread]
    .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
    .map(m => ({
      id: m.id,
      who: String(m.fromName ?? '').trim() || String(m.fromEmail ?? '').trim() || 'Unknown sender',
      email: String(m.fromEmail ?? '').trim().toLowerCase(),
      to: String(m.to ?? '').trim(),
      at: m.at ?? null,
      body: String(m.body ?? '').trim() || '(no text — the message may be an image or an attachment only)',
      html: String(m.html ?? '').trim() || null,
      direction: directionOf(m.fromEmail),
      scanned: m.id === String(row.gmail_message_id ?? ''),
    }))
  const status = String(row.status ?? '')
  const pct = typeof row.confidence === 'number' ? ` · ${Math.round(row.confidence * 100)}% sure` : ''
  return {
    subject: String(row.subject ?? '').trim() || String(thread[0]?.subject ?? '').trim() || '(no subject)',
    mailbox: String(row.mailbox ?? '').toLowerCase(),
    decision: `${INGEST_STATUS_WORDS[status] ?? (status || 'Read')}${pct}`,
    reasoning: String(row.reasoning ?? '').trim() || null,
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    lead_id: row.lead_id ?? null,
    messages,
  }
}

/** the page's address for a scanned message */
export const conversationPath = (ingestId: string) => `/dashboard/leads/acquisition/scanning/${encodeURIComponent(ingestId)}`

/** why a thread could not be shown, in words a person can act on */
export function conversationRefusal(row: IngestRowLike | null, mailboxKnown: boolean): string | null {
  if (!row) return 'That message is not in the scanner’s log.'
  if (!row.gmail_message_id) return 'The scanner did not keep the message id for this row, so the thread cannot be fetched.'
  if (!mailboxKnown) return `The scanner has no credentials for ${String(row.mailbox ?? 'that mailbox')} right now, so the thread cannot be read.`
  return null
}

/** what a reply to this thread is addressed to: the last message from outside, in its thread */
export type ReplyableMessage = ThreadMessageLike & { threadId?: string | null; messageId?: string | null; references?: string | null; replyTo?: string | null; listUnsubscribe?: string | null; autoSubmitted?: string | null }

/** the message a reply answers: the last one from outside */
export function replyTarget(thread: readonly ReplyableMessage[]): ReplyableMessage | null {
  return [...thread].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).find(m => directionOf(m.fromEmail) === 'in') ?? null
}

const MACHINE_SENDER = /(^|[.\-_])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce|notifications?|newsletter|marketing)([.\-_@]|$)|@em\d*\.cloudflare\.com$|@.*\.(sendgrid|mailchimp|mailgun|amazonses|hubspotemail|sparkpostmail)\./i

/** why a reply to this thread would only bounce: an automated sender (seen live, 23 Sep 2026: a reply to a Cloudflare
 *  newsletter went to em@em1.cloudflare.com and came back "550 5.7.1 relaying denied") */
export function replyRefusal(thread: readonly ReplyableMessage[]): string | null {
  const last = replyTarget(thread)
  if (!last) return NOBODY_TO_REPLY_TO
  const to = String(last.replyTo ?? '').trim() || String(last.fromEmail ?? '').trim()
  if (!to) return NOBODY_TO_REPLY_TO
  const automated = Boolean(String(last.listUnsubscribe ?? '').trim()) || /^auto-/i.test(String(last.autoSubmitted ?? '').trim()) || MACHINE_SENDER.test(to)
  if (automated) return `This came from an automated sender (${to}) — a reply would only bounce. There is nobody at that address.`
  return null
}

export function replyDraft(thread: readonly ReplyableMessage[], subjectFallback: string): { to: string; subject: string; threadId: string | null; inReplyTo: string | null; references: string | null } | null {
  const last = replyTarget(thread)
  if (!last) return null
  // a sender who set Reply-To wants the answer there, not at the address the mail went out from
  const to = String(last.replyTo ?? '').trim() || String(last.fromEmail ?? '').trim()
  if (!to) return null
  const subject = String(last.subject ?? '').trim() || subjectFallback
  return {
    to,
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    threadId: last.threadId ?? null,
    inReplyTo: last.messageId ?? null,
    references: [last.references, last.messageId].map(s => String(s ?? '').trim()).filter(Boolean).join(' ') || null,
  }
}

export const REPLY_TEXT_MAX = 4000
export const NOBODY_TO_REPLY_TO = 'Every message in this thread is ours — there is nobody to reply to.'
export const MAILBOX_CANNOT_SEND = (mailbox: string) => `${mailbox} can read but not reply yet. On the Scanning page press Connect for replies beside it, pick that account and allow both.`

/* ── the body, laid out (the owner, 23 Sep 2026: "the lines when replying doesnt layout nicely", "there are links
   … a lot of flaw in the design"): plain-text email arrives hard-wrapped at ~72 characters, with links as
   `label <https://…>` or bare, and the whole earlier thread quoted under "On … wrote:". Unwrap the paragraphs,
   make the links clickable with a short label, and fold the quoted history away. No I/O. ── */

export type BodyToken = { kind: 'text'; text: string } | { kind: 'link'; href: string; label: string }
export type BodyView = { paragraphs: BodyToken[][]; quoted: string | null; signature: string | null }

const QUOTE_HEAD_RE = /^(On .{6,200} wrote:|-{2,}\s*(Original|Forwarded) Message\s*-{2,}|From: .+)$/i

/** a link's short label: the host and, when there is one, the first path word */
export function linkLabel(href: string): string {
  try {
    const u = new URL(href)
    const host = u.hostname.replace(/^www\./, '')
    const first = u.pathname.split('/').filter(Boolean)[0]
    return first && first.length <= 24 ? `${host}/${first}` : host
  } catch { return href }
}

/** where the quoted history starts: the "On … wrote:" line, or the first run of "> " lines */
export function splitQuoted(body: string): { own: string; quoted: string | null } {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  let at = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (QUOTE_HEAD_RE.test(l) || (l.startsWith('>') && lines.slice(i, i + 3).every(x => x.trim().startsWith('>') || x.trim() === ''))) { at = i; break }
  }
  if (at <= 0) return { own: at === 0 ? '' : body, quoted: at === 0 ? body : null }
  return { own: lines.slice(0, at).join('\n').trim(), quoted: lines.slice(at).join('\n').trim() || null }
}

/** hard-wrapped lines back into paragraphs: a long line that ends without a stop continues onto the next */
export function unwrapParagraphs(text: string): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = para.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '')
    if (lines.length === 0) continue
    let cur = lines[0]
    for (let i = 1; i < lines.length; i++) {
      const prev = cur.split('\n').at(-1) ?? ''
      const next = lines[i]
      const listy = /^\s*([-*•]|\d+[.)])\s/.test(next) || /^\s{2,}/.test(next)
      const joins = prev.length >= 55 && !/[.!?:]$/.test(prev.trim()) && !listy
      cur = joins ? `${cur} ${next.trim()}` : `${cur}\n${next}`
    }
    out.push(cur.trim())
  }
  return out
}

/** one paragraph into text and link tokens: `label <url>`, `label (url)`, `[label](url)`, or a bare url */
export function tokenise(paragraph: string): BodyToken[] {
  const tokens: BodyToken[] = []
  const re = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)|([^\s<(\[][^<(\n]{0,80}?)\s*[<(](https?:\/\/[^\s<>()]+)[>)]|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g
  let last = 0
  for (const m of paragraph.matchAll(re)) {
    const start = m.index ?? 0
    if (start > last) tokens.push({ kind: 'text', text: paragraph.slice(last, start) })
    if (m[1] && m[2]) tokens.push({ kind: 'link', href: m[2], label: m[1].trim() })
    else if (m[3] !== undefined && m[4]) {
      const label = m[3].trim()
      // "Watch it here <url>" keeps its words; a label that is itself the url, or empty, gets the short one
      tokens.push({ kind: 'link', href: m[4], label: label && !/^https?:\/\//.test(label) ? label : linkLabel(m[4]) })
    } else if (m[5]) tokens.push({ kind: 'link', href: m[5], label: linkLabel(m[5]) })
    last = start + m[0].length
  }
  if (last < paragraph.length) tokens.push({ kind: 'text', text: paragraph.slice(last) })
  return tokens
}

/** the message body as the page draws it */
export function bodyView(body: string | null | undefined): BodyView {
  const { own: beforeQuote, quoted } = splitQuoted(String(body ?? ''))
  const { own, signature } = splitSignature(beforeQuote)
  return { paragraphs: unwrapParagraphs(own).map(tokenise), quoted, signature }
}

/* ── HTML mail, drawn like a mail client does (research, 23 Sep 2026: Close.com "Rendering untrusted HTML email,
   safely"; AdGuard's mail renderer; GitHub's email_reply_parser): sanitise with DOMPurify, draw in a script-less
   sandboxed iframe with its own CSP, block remote images until asked, and fold the quoted history the sending
   client wrapped in its own markers. The selectors and the frame's CSS live here so they are tested. ── */

/** where each mail client puts the earlier messages it quotes */
export const QUOTE_SELECTORS = [
  '.gmail_quote', 'blockquote[type="cite"]', '#divRplyFwdMsg', '#isReplyFwdMsg', '.yahoo_quoted',
  '.moz-cite-prefix', '#appendonsend', '.protonmail_quote', 'blockquote.gmail_quote', '.zmail_extra',
] as const

/** the frame's own stylesheet: readable, contained, nothing wider than the card */
export const EMAIL_FRAME_CSS = `
  html, body { margin: 0; padding: 0; }
  body { font: 14px/1.6 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; word-break: break-word; overflow-wrap: anywhere; }
  img { max-width: 100% !important; height: auto; }
  table { max-width: 100% !important; }
  pre { white-space: pre-wrap; }
  a { color: #0057ff; }
  blockquote { margin: 0 0 0 .75em; padding-left: .75em; border-left: 2px solid #ccc; color: #555; }
  .mdm-signature { color: #666; font-size: 13px; margin-top: 1em; }
  .mdm-signature img { max-width: 200px !important; max-height: 80px; width: auto; }
  img[src=""], img:not([src]) { display: none; }
`

/** where each mail client puts the sender's signature */
export const SIGNATURE_SELECTORS = ['.gmail_signature', '#Signature', '#ms-outlook-mobile-signature', '.moz-signature', '[data-smartmail="gmail_signature"]', '.protonmail_signature_block'] as const

/** a plain-text signature starts at the "-- " line (RFC 3676) */
export function splitSignature(text: string): { own: string; signature: string | null } {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex(l => /^--\s?$/.test(l))
  if (at < 0) return { own: text, signature: null }
  return { own: lines.slice(0, at).join('\n').trim(), signature: lines.slice(at + 1).join('\n').trim() || null }
}

/** the document the frame draws: no scripts by policy, links open outside, the sanitised body */
export function emailFrameDocument(sanitisedBody: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; script-src 'none'; frame-src 'none'"><base target="_blank"><style>${EMAIL_FRAME_CSS}</style></head><body>${sanitisedBody}</body></html>`
}

/** a reply's HTML from its plain text: one <p> per paragraph, <br> for a line break, links clickable, nothing else */
export function replyHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const linkify = (s: string) => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?'")]/g, u => `<a href="${u}">${u}</a>`)
  return text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)
    .map(p => `<p style="margin:0 0 1em">${p.split('\n').map(linkify).join('<br>')}</p>`)
    .join('')
}

/* ── A SIGNATURE UNDER EVERY REPLY (the owner, 23 Sep 2026: "replying from hello can be shown as the signature in
   the bottom"): kept per mailbox in Settings → Inbox scanner, appended to the reply's text (after the RFC 3676
   "-- " line, so other clients fold it) and to its html (dimmed, as the frame draws signatures). ── */

export const SIGNATURE_MAX = 1200

/** the reply's text with the mailbox's signature under it, or unchanged when there is none */
export function withSignatureText(text: string, signature: string | null | undefined): string {
  const sig = String(signature ?? '').replace(/\r\n/g, '\n').trim()
  return sig ? `${text.trim()}\n\n-- \n${sig}` : text.trim()
}

/** the reply's html with the signature under it: one line per line, links clickable, nothing else */
export function signatureHtml(signature: string | null | undefined): string {
  const sig = String(signature ?? '').replace(/\r\n/g, '\n').trim()
  if (!sig) return ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const linkify = (s: string) => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?'")]/g, u => `<a href="${u}">${u}</a>`)
  return `<div class="mdm-signature" style="margin-top:1.5em;color:#666;font-size:13px;line-height:1.5">${sig.split('\n').map(linkify).join('<br>')}</div>`
}

/** a signature as saved from Settings: trimmed, bounded, or null for none */
export function cleanSignature(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/\r\n/g, '\n').trim()
  return s ? s.slice(0, SIGNATURE_MAX) : null
}
