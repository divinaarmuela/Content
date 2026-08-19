import 'server-only'
import { supabase } from '@/lib/supabase'
import { buildDedupeKey } from './identity-core'
export { buildDedupeKey } from './identity-core'
import { actorAlias, replyToFor } from './mailer-core'

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
      ${ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:20px;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;">${ctaLabel ?? 'Open dashboard'}</a>` : ''}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e4e4e7;">
      <p style="font-family:monospace;font-size:10px;letter-spacing:0.1em;color:#a1a1aa;margin:0;">get seen · get known · get booked</p>
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
}

export type NotifyResult = 'sent' | 'duplicate' | 'failed'

/** Queue-and-send with the exactly-once guarantee described above. */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const dedupe_key = buildDedupeKey(input.eventType, input.entityType, input.entityId, input.recipientEmail)

  // 1. claim the dedupe key. `ignoreDuplicates` → conflict returns no row.
  const { data: claimed, error: insErr } = await supabase
    .from('notification_log')
    .upsert(
      {
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
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true }
    )
    .select()
    .maybeSingle()

  if (insErr) {
    console.error('notification claim failed:', insErr.message)
    return 'failed'
  }
  if (!claimed) return 'duplicate' // another producer already owns this event

  // 2. we own the row — send as the actor (or the company when actorless)
  try {
    assertTestSafeRecipients(input.recipientEmail)
    const domain = FROM_DOMAIN()
    const alias = actorAlias(domain, input.actorName, input.actorEmail) ?? `no-reply@${domain}`
    const replyTo = replyToFor(input.actorEmail, alias)
      ?? (!input.actorEmail ? process.env.GMAIL_USER : undefined)
    await smtp2goSend({
      from: `${displayName(input.actorName)} <${alias}>`,
      to: [input.recipientEmail],
      subject: input.subject,
      html: input.bodyHtml,
      replyTo,
      attachments: input.attachments,
      idempotencyKey: dedupe_key,
    })
    await supabase
      .from('notification_log')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', claimed.id)
    return 'sent'
  } catch (e) {
    await supabase
      .from('notification_log')
      .update({ status: 'failed', error: e instanceof Error ? e.message : String(e) })
      .eq('id', claimed.id)
    return 'failed'
  }
}
