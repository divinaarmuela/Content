import 'server-only'
import {
  extractBody, header, parseFromHeader, type GmailPayload,
} from './gmail-core'
import { buildClaims, signAssertion } from './google-jwt'

/**
 * Gmail REST client supporting MULTIPLE mailboxes, via either auth mode:
 *
 * A. Domain-wide delegation (preferred for a Workspace domain — no mailbox
 *    passwords needed). A Workspace admin authorises one service account to
 *    impersonate users, then we list the mailboxes to scan:
 *      GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
 *      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
 *      GMAIL_SCAN_MAILBOXES=hello@x.com,contact@x.com,info@x.com
 *
 * B. Per-mailbox OAuth refresh tokens (requires signing in as each mailbox):
 *      GMAIL_MAILBOXES=[{"email":"hello@x.com","refreshToken":"1//..."}, …]
 *    or the legacy single pair GMAIL_USER + GMAIL_REFRESH_TOKEN.
 *
 * Mode A wins when configured; B remains the fallback so existing setups and
 * the sending path keep working unchanged.
 */

export type Mailbox = {
  email: string
  /** Mode B: long-lived refresh token for this mailbox */
  refreshToken?: string
  /** Mode A: impersonate via the service account (domain-wide delegation) */
  delegated?: boolean
  /** Mode C: a ready access token (e.g. supplied by Clerk for a signed-in user) */
  accessToken?: string
  /** Which OAuth client issued `refreshToken`. A refresh token is bound to its
   *  client, so a mailbox connected through the inbox-connect app cannot be
   *  refreshed with the credentials that minted hello@'s token 60 days ago. */
  clientId?: string
  clientSecret?: string
}

const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

function serviceAccountConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()
  )
}

/** All configured mailboxes, de-duplicated by address. */
export function getMailboxes(): Mailbox[] {
  // Mode A — domain-wide delegation
  if (serviceAccountConfigured()) {
    const list = (process.env.GMAIL_SCAN_MAILBOXES ?? process.env.GMAIL_USER ?? '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const seen = new Set<string>()
    return list.filter(e => !seen.has(e) && seen.add(e)).map(email => ({ email, delegated: true }))
  }

  // Mode B — per-mailbox refresh tokens
  const out: Mailbox[] = []
  const raw = process.env.GMAIL_MAILBOXES
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as { email?: string; refreshToken?: string }[]
      for (const m of parsed) {
        if (m?.email && m?.refreshToken) {
          out.push({ email: m.email.trim().toLowerCase(), refreshToken: m.refreshToken.trim() })
        }
      }
    } catch {
      console.error('GMAIL_MAILBOXES is not valid JSON — falling back to GMAIL_USER')
    }
  }
  const legacyEmail = process.env.GMAIL_USER?.trim().toLowerCase()
  const legacyToken = process.env.GMAIL_REFRESH_TOKEN?.trim()
  if (legacyEmail && legacyToken && !out.some(m => m.email === legacyEmail)) {
    out.push({ email: legacyEmail, refreshToken: legacyToken })
  }
  return out
}

// one cached access token per cache key (refresh token, or sa:<mailbox>:<scope>)
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

function cached(key: string): string | null {
  const hit = tokenCache.get(key)
  return hit && Date.now() < hit.expiresAt - 60_000 ? hit.token : null
}

/** Mode A: impersonate a mailbox using the service account (domain-wide
 *  delegation). Requires the Workspace admin to have authorised the service
 *  account's client id for the requested scope. */
async function delegatedToken(mailboxEmail: string, scope = GMAIL_READ_SCOPE): Promise<string> {
  const key = `sa:${mailboxEmail}:${scope}`
  const hit = cached(key)
  if (hit) return hit

  const assertion = signAssertion(
    buildClaims({
      serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
      subject: mailboxEmail,
      scope,
      nowSec: Math.floor(Date.now() / 1000),
    }),
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!
  )

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    throw new Error(
      `Delegated token failed for ${mailboxEmail} (${res.status}): ${await res.text()} — ` +
      `check the service account is authorised for "${scope}" in Admin console → Security → API controls → Domain-wide delegation`
    )
  }
  const json = await res.json()
  tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 })
  return json.access_token
}

/** Mode B: refresh-token exchange. */
async function refreshTokenAccess(
  refreshToken: string, clientId?: string, clientSecret?: string,
): Promise<string> {
  const hit = cached(refreshToken)
  if (hit) return hit
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId || process.env.GMAIL_CLIENT_ID || '',
      client_secret: clientSecret || process.env.GMAIL_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Gmail token exchange failed: ${await res.text()}`)
  const json = await res.json()
  tokenCache.set(refreshToken, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 })
  return json.access_token
}

async function accessTokenForMailbox(mailbox: Mailbox, scope = GMAIL_READ_SCOPE): Promise<string> {
  if (mailbox.accessToken) return mailbox.accessToken // Mode C — already fresh
  if (mailbox.delegated) return delegatedToken(mailbox.email, scope)
  if (mailbox.refreshToken) {
    return refreshTokenAccess(mailbox.refreshToken, mailbox.clientId, mailbox.clientSecret)
  }
  throw new Error(`No credentials for mailbox ${mailbox.email}`)
}

async function gmailGet<T>(mailbox: Mailbox, path: string): Promise<T> {
  const token = await accessTokenForMailbox(mailbox)
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`Gmail ${path} failed for ${mailbox.email} (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

export type InboxMessage = {
  id: string
  threadId: string
  mailbox: string
  fromName: string
  fromEmail: string
  subject: string
  receivedAt: string | null
  body: string
  listUnsubscribe: string
  autoSubmitted: string
}

/** IDs of recent inbox messages for one mailbox (newest first). */
export async function listRecentMessageIds(
  mailbox: Mailbox,
  query = 'in:inbox newer_than:3d',
  max = 25
): Promise<string[]> {
  const json = await gmailGet<{ messages?: { id: string }[] }>(
    mailbox,
    `messages?q=${encodeURIComponent(query)}&maxResults=${max}`
  )
  return (json.messages ?? []).map(m => m.id)
}

/** Full message from one mailbox, parsed to the fields the classifier needs. */
export async function fetchMessage(mailbox: Mailbox, id: string): Promise<InboxMessage> {
  const json = await gmailGet<{
    id: string; threadId: string; internalDate?: string; payload?: GmailPayload
  }>(mailbox, `messages/${id}?format=full`)

  const headers = json.payload?.headers
  const from = parseFromHeader(header(headers, 'From'))
  return {
    id: json.id,
    threadId: json.threadId,
    mailbox: mailbox.email,
    fromName: from.name,
    fromEmail: from.email,
    subject: header(headers, 'Subject'),
    receivedAt: json.internalDate ? new Date(Number(json.internalDate)).toISOString() : null,
    body: json.payload ? extractBody(json.payload).slice(0, 8000) : '',
    listUnsubscribe: header(headers, 'List-Unsubscribe'),
    autoSubmitted: header(headers, 'Auto-Submitted'),
  }
}

/** The primary sending mailbox (notifications, reports). */
export function mailboxAddress(): string {
  return (process.env.GMAIL_USER ?? '').toLowerCase()
}

// There is deliberately NO Gmail send path here. Every outbound email in this
// codebase goes through app/lib/mailer.ts, whose one transport (smtp2goSend)
// is module-private and reached only via sendRawEmail / sendSystemEmail /
// notify — all three of which call assertTestSafeRecipients first. Two raw
// Gmail senders used to live here, unused and ungated; they were a standing
// invitation to add a send path that skips the EMAIL_TEST_ONLY kill-switch,
// so they are gone. Read-only Gmail access (the inbox → leads pipeline) is
// everything above.
