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
    await transporter.sendMail({
      from: `MD Media <${process.env.GMAIL_USER}>`,
      to: input.recipientEmail,
      subject: input.subject,
      html: input.bodyHtml,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
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
