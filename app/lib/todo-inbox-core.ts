/**
 * THE TO-DOS INBOX AND PROJECTS — the pure half (the owner, 20 Oct 2026, Manal's video of Asana: an Inbox of what
 * people did on your tasks — "Raven Arellano completed this task · 4 hours ago" — with an @Mentioned tab, and a
 * Project per client, each with its own coloured icon).
 */

export type InboxRow = {
  id: string; event_type: string; subject: string; entity_type: string; entity_id: string
  body_html?: string | null; created_at: string; read_at?: string | null; recipient_id: string
}

export type InboxItem = {
  id: string
  event: string
  /** the task it is about — the notification's entity is "<todo id>#<event key>" */
  todoId: string
  /** "Raven Arellano completed Trend Spotting: Luxe" */
  subject: string
  /** a comment's own words, when there was one */
  quote: string | null
  at: string
  read: boolean
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

export function inboxItemOf(r: InboxRow): InboxItem {
  const quote = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i.exec(String(r.body_html ?? ''))?.[1]
  return {
    id: r.id,
    event: r.event_type,
    todoId: String(r.entity_id ?? '').split('#')[0],
    subject: String(r.subject ?? ''),
    quote: quote ? unescape(quote.replace(/<[^>]+>/g, '')).trim().slice(0, 500) || null : null,
    at: r.created_at,
    read: !!r.read_at,
  }
}

/** Asana's tabs: Activity (everything) and @Mentioned (where you were tagged) */
export type InboxTab = 'activity' | 'mentioned'
export function inboxFor(items: readonly InboxItem[], tab: InboxTab): InboxItem[] {
  return tab === 'mentioned' ? items.filter(i => i.event === 'todo_tagged' || i.event === 'todo_mentioned') : [...items]
}

/** Today · Yesterday · Earlier — Asana's headings, in the viewer's own days */
export function inboxDay(at: string, today: string): 'Today' | 'Yesterday' | 'Earlier' {
  const day = at.slice(0, 10)
  if (day === today) return 'Today'
  const y = new Date(`${today}T00:00:00Z`); y.setUTCDate(y.getUTCDate() - 1)
  return day === y.toISOString().slice(0, 10) ? 'Yesterday' : 'Earlier'
}

/** "4 hours ago", "2 days ago" */
export function agoWords(at: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`
}

/** A project's colour when it has no logo: its brand's main colour, or one of Asana's, the same every time */
const PALETTE = ['#f06a6a', '#ec8d71', '#f1bd6c', '#5da283', '#4ecbc4', '#4573d2', '#8d84e8', '#e362e3', '#fc979a', '#6d6e6f']
export function projectColour(id: string, brandHex?: string | null): string {
  if (brandHex && /^#[0-9a-f]{6}$/i.test(brandHex)) return brandHex
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
