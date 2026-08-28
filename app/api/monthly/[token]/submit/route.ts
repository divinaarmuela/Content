import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { submitMonthly } from '../../../../lib/monthly'
import { notify, renderEmail } from '../../../../lib/mailer'
import { completion, resolveRecipients } from '../../../../lib/intake-core'
import { renderMonthlyPdf } from '../../../../lib/monthly-pdf'
import { monthLabel } from '../../../../lib/monthly-core'
import { inngest } from '../../../../inngest/client'
import { monthlyChannel } from '../../../../inngest/channels'

export const dynamic = 'force-dynamic'
// Building the PDF takes longer than a default serverless slice allows.
export const maxDuration = 60

/**
 * Finalise a monthly update: freeze it read-only, render the PDF, and email the
 * chosen TEAM members the answers + PDF. The client is NEVER emailed — this is
 * an internal planning form.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await submitMonthly(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: client } = await supabase
    .from('clients').select('name').eq('id', form.client_id).maybeSingle()
  const name = client?.name ?? 'A client'
  const progress = completion(form.definition, form.answers)
  const period = monthLabel(form.month, form.year)

  // An email link must be absolute. NEXT_PUBLIC_APP_URL is set in production;
  // VERCEL_URL covers previews; the domain is the last resort.
  const base =
    process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    ?? 'https://www.mdmmarketing.com.au'

  // Who hears about it: this form's own list (chosen at creation), else the
  // sending mailbox — so a submission is never silently unannounced. There is
  // no agency default table for monthly forms; recipients are always picked at
  // creation, so an EMPTY list means "notify nobody for this one" and is kept.
  const recipients = resolveRecipients(
    form.notify_emails,
    [],
    process.env.GMAIL_USER ?? '',
  )

  // Everything below is best-effort: the answers are already saved, so a failed
  // PDF or a bounced email must never turn a successful submission into an error
  // the client sees. notify() carries its own dedupe key, so a retry cannot
  // double-send.
  try {
    const pdf = await renderMonthlyPdf({
      clientName: name,
      formTitle: form.title || `Monthly update — ${period}`,
      definition: form.definition,
      answers: form.answers,
      submittedAt: new Date(),
    })

    const safeName =
      name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'client'

    await Promise.all(recipients.map(to => notify({
      eventType: 'monthly_submitted',
      entityType: 'monthly_update',
      entityId: form.id,
      recipientEmail: to,
      subject: `Monthly update submitted — ${name} · ${period}`,
      bodyHtml: renderEmail(
        'Monthly update submitted',
        `<p>${name} has completed their monthly content check-in for <strong>${period}</strong> ` +
        `— ${progress.answered} of ${progress.total} questions answered. ` +
        `Their answers are attached as a PDF, ready for the planning call.</p>`,
        'Open in dashboard',
        `${base}/dashboard/clients/${form.client_id}/monthly/${form.id}`,
      ),
      attachments: [
        { filename: `${safeName}-monthly-${form.year}-${String(form.month).padStart(2, '0')}.pdf`, content: pdf, contentType: 'application/pdf' },
      ],
    })))
  } catch (e) {
    console.error('monthly submit notification failed:', e)
  }

  void inngest.realtime.publish(monthlyChannel.progress, {
    form_id: form.id,
    client_id: form.client_id,
    status: form.status,
    answered: progress.answered,
    total: progress.total,
    ts: Date.now(),
  }).catch(e => console.error('monthly realtime publish failed:', e))

  return NextResponse.json({ status: form.status })
}
