import 'server-only'
import nodemailer from 'nodemailer'
import { supabase } from '@/lib/supabase'

/**
 * Notification outbox with exactly-once delivery.
 *
 * The race-condition guarantee: `notify()` INSERTs into notification_log with
 * a caller-supplied dedupe key BEFORE sending. The unique constraint on
 * dedupe_key means that when two concurrent triggers fire for the same event,
 * exactly one insert succeeds — the loser sees the conflict and sends nothing.
 * Email is the only channel today; desktop push later is a new `channel`
 * value, not a redesign.
 */

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    type: 'OAuth2',
    user: process.env.GMAIL_USER,
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  },
})

import { buildDedupeKey } from './identity-core'
export { buildDedupeKey } from './identity-core'
import { actorAlias, fromHeader, replyToFor } from './mailer-core'

/**
 * Hard test-mode kill-switch. When EMAIL_TEST_ONLY=1 (set by the E2E harness,
 * never in production env), any recipient whose address does not end in
 * `.invalid` is refused before a byte leaves the process. Testing must never
 * be able to email a real team member, whatever bug is upstream — the leak we
 * are defending against was exactly an upstream bug (an ambiguous join whose
 * empty result fell back to "email every super admin").
 */
function assertTestSafeRecipients(to: string | string[]): void {
  if (process.env.EMAIL_TEST_ONLY !== '1') return
  const all = Array.isArray(to) ? to : [to]
  const real = all.filter(a => !a.trim().toLowerCase().endsWith('.invalid'))
  if (real.length > 0) {
    throw new Error(`EMAIL_TEST_ONLY: refused to email real recipient(s): ${real.join(', ')}`)
  }
}

/** Direct send with optional attachments — used for generated documents
 *  (e.g. the monthly leads report). Sends via the Gmail REST API (HTTPS)
 *  rather than SMTP: verified deliverable end-to-end, and immune to the
 *  SMTP TLS interception some networks/AV impose. Callers own their dedupe;
 *  scheduled senders guard via their own state (report_settings.last_sent_for). */
export async function sendRawEmail(input: {
  to: string | string[]
  subject: string
  html: string
  attachments?: { filename: string; content: Buffer; contentType: string }[]
}): Promise<void> {
  assertTestSafeRecipients(input.to)
  const { gmailSendRaw } = await import('./gmail')
  const MailComposer = (await import('nodemailer/lib/mail-composer')).default
  const mail = new MailComposer({
    from: `MD Media <${process.env.GMAIL_USER}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
  })
  const rfc822 = await mail.compile().build()
  await gmailSendRaw(rfc822)
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
  /** Attachments are NOT recorded in notification_log — only the body is. A
   *  log row is for answering "was this sent, and what did it say"; storing
   *  megabytes of PDF against every row would make that table unusable. */
  attachments?: NotifyAttachment[]
  /** Who did the thing this email is about. With a connected Google account
   *  (actorClerkId + gmail.send granted) the mail is sent FROM their own
   *  Gmail — a real person-to-person thread. Otherwise it falls back to the
   *  shared mailbox showing "Their Name · MD Media" with Reply-To them. */
  actorName?: string | null
  actorEmail?: string | null
  actorClerkId?: string | null
}

/**
 * Send via Resend from the actor's personal alias on OUR verified domain.
 * True = sent. This is the path that works for EVERYONE: staff on a work
 * address send as that address; staff on a personal Gmail send as
 * "their.name@<domain>" with Reply-To carrying their real inbox — nobody can
 * ever legitimately send as gmail.com, so an alias on our domain is the
 * correct identity, not a workaround. Active once RESEND_API_KEY is set and
 * the domain is verified in Resend.
 */
async function sendViaResend(input: NotifyInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  const domain = (process.env.NOTIFY_FROM_DOMAIN ?? 'mdmmarketing.com.au').toLowerCase()
  const alias = actorAlias(domain, input.actorName, input.actorEmail)
  if (!alias) return false
  try {
    const replyTo = replyToFor(input.actorEmail, alias)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${input.actorName?.trim() || 'MD Media'} <${alias}>`,
        to: [input.recipientEmail],
        subject: input.subject,
        html: input.bodyHtml,
        ...(replyTo ? { reply_to: [replyTo] } : {}),
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map(a => ({
                filename: a.filename,
                content: a.content.toString('base64'),
                ...(a.contentType ? { content_type: a.contentType } : {}),
              })),
            }
          : {}),
      }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
    return true
  } catch (e) {
    console.error('Resend send failed, falling back:', e)
    return false
  }
}

/** Try to send from the actor's own Gmail. True = sent person-to-person. */
async function sendAsActor(input: NotifyInput): Promise<boolean> {
  if (!input.actorClerkId || !input.actorEmail) return false
  try {
    const { getUserGmailSendToken } = await import('./clerk-gmail')
    const token = await getUserGmailSendToken(input.actorClerkId)
    if (!token) return false
    const { gmailSendRawAs } = await import('./gmail')
    const MailComposer = (await import('nodemailer/lib/mail-composer')).default
    const mail = new MailComposer({
      // their own account: this From is genuine, nothing rewritten
      from: `${input.actorName?.trim() || input.actorEmail} <${input.actorEmail}>`,
      to: input.recipientEmail,
      subject: input.subject,
      html: input.bodyHtml,
      attachments: input.attachments,
    })
    await gmailSendRawAs(token, await mail.compile().build())
    return true
  } catch (e) {
    // expired grant, revoked scope, quota — never lose the notification over it
    console.error('send-as-actor failed, falling back to shared mailbox:', e)
    return false
  }
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

  // 2. we own the row — send, then record the outcome
  try {
    assertTestSafeRecipients(input.recipientEmail)
    // first choice: Resend, from the actor's alias on our domain — works for
    // every team member whatever address they sign in with
    if (await sendViaResend(input)) {
      await supabase
        .from('notification_log')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', claimed.id)
      return 'sent'
    }
    // second choice: the actor's own Gmail — the thread is between the two
    // people, sits in the actor's Sent mail, replies go straight back
    const sentAsActor = await sendAsActor(input)
    if (!sentAsActor) {
      const replyTo = replyToFor(input.actorEmail, process.env.GMAIL_USER)
      await transporter.sendMail({
        // shared-mailbox fallback: Gmail rewrites any other From ADDRESS; the
        // display name and Reply-To are ours — so it still reads as from the
        // person, and replying still reaches them (see mailer-core.ts)
        from: fromHeader(process.env.GMAIL_USER ?? '', input.actorName),
        to: input.recipientEmail,
        subject: input.subject,
        html: input.bodyHtml,
        ...(replyTo ? { replyTo } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      })
    }
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
