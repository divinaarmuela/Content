import 'server-only'
import { DbError, table } from '@/lib/db'
import type { NotificationLog, TeamUser } from '@/lib/db-types'
import { buildDedupeKey } from './identity-core'
export { buildDedupeKey } from './identity-core'
import { actorAlias, replyToFor } from './mailer-core'
import { EMAIL_FOOTER, OPEN_ITEM_CTA } from './email-voice-core'

/**
 * Notification outbox with exactly-once delivery, on a single transport.
 *
 * The race-condition guarantee: `notify()` INSERTs into notification_log with
 * a caller-supplied dedupe key BEFORE sending. The unique constraint on
 * dedupe_key means that when two concurrent triggers fire for the same event,
 * exactly one insert succeeds — the loser sees the conflict and sends nothing.
 *
 * SMTP2GO is the ONLY transport, by decision: the domain is verified there,
 * every address on it may send, and a failed send is recorded as failed in
 * notification_log rather than silently reruted through a shared mailbox.
 * No fallbacks — an email either goes out as the right person, or it is a
 * visible failure to fix.
 */

const FROM_DOMAIN = () => (process.env.NOTIFY_FROM_DOMAIN ?? 'mdmmarketing.com.au').toLowerCase()

/** Automated mail speaks as the company, not as a person's mailbox. */
export const noReplyAddress = () => `no-reply@${FROM_DOMAIN()}`

/**
 * Hard test-mode kill-switch. When EMAIL_TEST_ONLY=1 (set by the E2E harness,
 * never in production env), any recipient whose address does not end in
 * `.invalid` is refused before a byte leaves the process. Testing must never
 * be able to email a real team member, whatever bug is upstream.
 */
function assertTestSafeRecipients(to: string | string[]): void {
  if (process.env.EMAIL_TEST_ONLY !== '1') return
  const all = Array.isArray(to) ? to : [to]
  const real = all.filter(a => !a.trim().toLowerCase().endsWith('.invalid'))
  if (real.length > 0) {
    throw new Error(`EMAIL_TEST_ONLY: refused to email real recipient(s): ${real.join(', ')}`)
  }
}

type Smtp2goAttachment = { filename: string; content: Buffer; contentType?: string }

/** The one send path. Throws on any failure — callers decide what a failure
 *  means (notify() records it; direct senders surface it). */
async function smtp2goSend(input: {
  from: string
  to: string[]
  cc?: string[]
  subject: string
  html: string
  replyTo?: string
  attachments?: Smtp2goAttachment[]
  /** Resend-safe key so a retried request cannot double-send at the provider */
  idempotencyKey?: string
}): Promise<void> {
  const apiKey = process.env.SMTP2GO_API_KEY
  if (!apiKey) throw new Error('SMTP2GO_API_KEY is not set — email is not configured')
  const res = await fetch('https://api.smtp2go.com/v3/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Smtp2go-Api-Key': apiKey },
    body: JSON.stringify({
      sender: input.from,
      to: input.to,
      ...(input.cc?.length ? { cc: input.cc } : {}),
      subject: input.subject,
      html_body: input.html,
      ...(input.replyTo ? { custom_headers: [{ header: 'Reply-To', value: input.replyTo }] } : {}),
      ...(input.attachments?.length
        ? {
            attachments: input.attachments.map(a => ({
              filename: a.filename,
              fileblob: a.content.toString('base64'),
              mimetype: a.contentType ?? 'application/octet-stream',
            })),
          }
        : {}),
    }),
  })
  const json = await res.json().catch(() => null) as { data?: { succeeded?: number; failures?: string[]; error?: string } } | null
  if (!res.ok || !json?.data?.succeeded) {
    throw new Error(`SMTP2GO: ${JSON.stringify(json?.data?.failures ?? json?.data?.error ?? `HTTP ${res.status}`)}`)
  }
}

/** Company display name for an actor: "Manal Rizwan" or plain "MD Media". */
const displayName = (name?: string | null) =>
  (name?.trim() || 'MD Media').replace(/["<>\r\n]/g, '')

/** Direct company send with optional attachments — used for generated
 *  documents (e.g. the monthly leads report). From hello@ on the verified
 *  domain, via SMTP2GO like everything else. Callers own their dedupe. */
export async function sendRawEmail(input: {
  to: string | string[]
  subject: string
  html: string
  attachments?: { filename: string; content: Buffer; contentType: string }[]
}): Promise<void> {
  assertTestSafeRecipients(input.to)
  await smtp2goSend({
    from: `MD Media <${process.env.GMAIL_USER ?? `hello@${FROM_DOMAIN()}`}>`,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
  })
}

/**
 * Company-voice email for system mail with no acting person (contact-form
 * acknowledgements, signup notices). From no-reply@; replies route to the
 * shared inbox. Throws on failure.
 */
export async function sendSystemEmail(input: {
  to: string | string[]
  cc?: string | string[]
  subject: string
  html: string
  replyTo?: string
}): Promise<void> {
  assertTestSafeRecipients(input.to)
  if (input.cc) assertTestSafeRecipients(input.cc)
  await smtp2goSend({
    from: `MD Media <no-reply@${FROM_DOMAIN()}>`,
    to: Array.isArray(input.to) ? input.to : [input.to],
    cc: input.cc ? (Array.isArray(input.cc) ? input.cc : [input.cc]) : undefined,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo ?? process.env.GMAIL_USER ?? `hello@${FROM_DOMAIN()}`,
  })
}

/** Escape user text before it goes into an email HTML body. */
export function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>')
}

/** Shared email chrome matching the brand. */
export function renderEmail(title: string, bodyHtml: string, ctaLabel?: string, ctaUrl?: string): string {
  return `
  <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#fafafa;color:#18181b;">
    <div style="background:#18181b;padding:20px 32px;border-bottom:3px solid #2563eb;">
      <p style="font-family:monospace;font-size:11px;letter-spacing:0.15em;color:#a1a1aa;margin:0;">MD MEDIA</p>
    </div>
    <div style="padding:32px;">
      <h2 style="font-size:18px;margin:0 0 12px;letter-spacing:-0.02em;">${title}</h2>
      <div style="font-size:14px;line-height:1.6;color:#3f3f46;">${bodyHtml}</div>
      ${ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:20px;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;">${ctaLabel ?? OPEN_ITEM_CTA}</a>` : ''}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e4e4e7;">
      <p style="font-size:12px;line-height:1.5;color:#71717a;margin:0;">${EMAIL_FOOTER}</p>
    </div>
  </div>`
}

export type NotifyAttachment = {
  filename: string
  content: Buffer
  contentType?: string
}

export type NotifyInput = {
  eventType: string
  entityType: string
  entityId: string
  recipientId?: string | null
  recipientEmail: string
  subject: string
  bodyHtml: string
  /** Attachments are NOT recorded in notification_log — only the body is. */
  attachments?: NotifyAttachment[]
  /** Who did the thing this email is about. The mail sends FROM their
   *  address on our domain (their real address when it's on the domain, a
   *  stable name alias otherwise) with Reply-To their actual inbox. */
  actorName?: string | null
  actorEmail?: string | null
  /** kept for call-site compatibility; unused since the Gmail path was removed */
  actorClerkId?: string | null
  /** Override where replies go. A no-reply sender still wants a human
   *  address behind it, or a customer's reply vanishes. */
  replyTo?: string | null
  /** Record it for the in-app bell but send no email. For people who should
   *  SEE something happened without their inbox filling up. */
  bellOnly?: boolean
}

export type NotifyResult = 'sent' | 'duplicate' | 'failed' | 'muted'

/** Queue-and-send with the exactly-once guarantee described above. */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  // The kill-switch covers the BELL too. A bell-only notification never
  // reaches smtp2goSend, so the guard down in the send path never runs for it
  // — and a test would otherwise write a real in_app row against a real team
  // member's recipient_id (WATCHERS in booking-notify.ts is a literal list of
  // agency addresses). Checked here, before the notification_log claim, so
  // under EMAIL_TEST_ONLY nothing at all is written for a real address.
  if (input.bellOnly && process.env.EMAIL_TEST_ONLY === '1') {
    try {
      assertTestSafeRecipients(input.recipientEmail)
    } catch (e) {
      console.error('notification refused:', e instanceof Error ? e.message : e)
      return 'failed'
    }
  }

  // the Settings → "email notifications" toggle is a promise, not decoration:
  // a recipient who switched email off gets nothing, checked here so every
  // notification path honours it. Only an explicit false mutes — no row, no
  // prefs, or a lookup error all fail open to sending.
  if (input.recipientId) {
    const prefRow = await table<TeamUser>('team_users').get(input.recipientId)
    const prefs = prefRow?.notification_prefs as { email?: boolean } | null | undefined
    if (prefs?.email === false) return 'muted'
  }

  const dedupe_key = buildDedupeKey(input.eventType, input.entityType, input.entityId, input.recipientEmail)

  const log = table<NotificationLog>('notification_log')

  // 1. claim the dedupe key. The unique key on dedupe_key means the loser of
  // a concurrent claim is refused rather than given a second row.
  let owned: NotificationLog | null = null
  try {
    owned = await table('notification_log').insert({
      dedupe_key,
      event_type: input.eventType,
      recipient_id: input.recipientId ?? null,
      recipient_email: input.recipientEmail,
      subject: input.subject,
      body_html: input.bodyHtml,
      entity_type: input.entityType,
      entity_id: input.entityId,
      channel: 'email',
      status: 'pending',
    }) as unknown as NotificationLog
  } catch (e) {
    if (!(e instanceof DbError && e.code === 'unique')) {
      console.error('notification claim failed:', e instanceof Error ? e.message : e)
      return 'failed'
    }
  }
  if (!owned) {
    // someone owns the key — but a FAILED send (or a pending row stranded by
    // a crash >10 min ago) must not block the event forever. Re-claim it with
    // an optimistic guard: exactly one retrier wins, a sent row stays sent.
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString()
    const held = (await log.list({ where: r => r.dedupe_key === dedupe_key, limit: 1 }))[0]
    if (!held) return 'duplicate'
    // The reclaim predicate is evaluated INSIDE the write, so two retriers
    // cannot both take the same failed row and send the email twice.
    //
    // The winner stamps `claimed_at`, and staleness is judged on it: the
    // stale rule is "pending for more than ten minutes", and created_at
    // cannot express that once a row has been reclaimed — it does not move,
    // so the next retrier along would find the row it just took still
    // "stale", take it in turn, and send the same email again. claimed_at is
    // when the row was last picked up, which is the thing being timed.
    const reclaimed = await log.claim(held.id, cur => {
      const pendingSince = cur?.claimed_at ?? cur?.created_at ?? ''
      const reclaimable = !!cur && (
        cur.status === 'failed'
        || (cur.status === 'pending' && pendingSince < staleBefore)
      )
      return reclaimable
        ? {
            ...cur!,
            status: 'pending',
            claimed_at: new Date().toISOString(),
            body_html: input.bodyHtml,
            subject: input.subject,
          }
        : null
    })
    if (!reclaimed.claimed) return 'duplicate' // genuinely sent (or in flight) — stop
    owned = reclaimed.row
  }
  const claimedId = owned.id

  // bell-only: the row (which is what the notifications page reads) is
  // enough — no email leaves the building for this recipient
  if (input.bellOnly) {
    await log.update(claimedId, { status: 'sent', channel: 'in_app' })
    return 'sent'
  }

  // 2. we own the row — send as the actor (or the company when actorless)
  try {
    assertTestSafeRecipients(input.recipientEmail)
    const domain = FROM_DOMAIN()
    // the portal's machine identity (portal+<id>@) is for the audit trail,
    // never for a From line — those emails speak as the company, replies to
    // the shared inbox
    const isPortalActor = input.actorEmail?.toLowerCase().startsWith('portal+') ?? false
    const alias = isPortalActor
      ? `no-reply@${domain}`
      : actorAlias(domain, input.actorName, input.actorEmail) ?? `no-reply@${domain}`
    const replyTo = input.replyTo?.trim()
      || (isPortalActor
        ? process.env.GMAIL_USER
        : replyToFor(input.actorEmail, alias)
          ?? (!input.actorEmail ? process.env.GMAIL_USER : undefined))
    await smtp2goSend({
      from: `${displayName(input.actorName)} <${alias}>`,
      to: [input.recipientEmail],
      subject: input.subject,
      html: input.bodyHtml,
      replyTo,
      attachments: input.attachments,
      idempotencyKey: dedupe_key,
    })
    await log.update(claimedId, { status: 'sent', sent_at: new Date().toISOString() })
    return 'sent'
  } catch (e) {
    await log.update(claimedId, { status: 'failed', error: e instanceof Error ? e.message : String(e) })
    return 'failed'
  }
}
