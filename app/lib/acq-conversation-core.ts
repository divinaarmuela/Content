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
