import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { submitIntake, getIntakeDefaultRecipients } from '../../../../lib/intake'
import { notify, renderEmail } from '../../../../lib/mailer'
import { completion, resolveRecipients } from '../../../../lib/intake-core'
import { inngest } from '../../../../inngest/client'
import { intakeChannel } from '../../../../inngest/channels'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await submitIntake(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: client } = await supabase
    .from('clients').select('name').eq('id', form.client_id).maybeSingle()
  const name = client?.name ?? 'A client'
  const progress = completion(form.definition, form.answers)
  // An email link must be absolute. NEXT_PUBLIC_APP_URL is not set anywhere
  // today, so falling back to '' would have produced "/dashboard/clients/…" —
  // a dead link in every mail client. VERCEL_URL covers preview deployments.
  const base =
    process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    ?? 'https://www.mdmmarketing.com.au'

  // Best-effort. The answers are already saved, so a failed email must never
  // fail the client's submission — they did their part. notify() carries its
  // own dedupe key, so a double submit cannot send this twice.
  // Who hears about it: this form's own list, else the agency default, else
  // the sending mailbox — so a submission is never silently unannounced.
  const recipients = resolveRecipients(
    form.notify_emails,
    await getIntakeDefaultRecipients(),
    process.env.GMAIL_USER ?? '',
  )

  try {
    // one notify() per recipient: its dedupe key includes the address, so each
    // person is emailed exactly once even if submit is somehow retried
    await Promise.all(recipients.map(to => notify({
      eventType: 'intake_submitted',
      entityType: 'intake_form',
      entityId: form.id,
      recipientEmail: to,
      subject: `Intake form submitted — ${name}`,
      bodyHtml: renderEmail(
        'Intake form submitted',
        `<p>${name} has completed their ${form.template_key.replace('_', '-')} intake form ` +
        `— ${progress.answered} of ${progress.total} questions answered.</p>`,
        'Open in dashboard',
        `${base}/dashboard/clients/${form.client_id}`,
      ),
    })))
  } catch (e) {
    console.error('intake submit notification failed:', e)
  }

  void inngest.realtime.publish(intakeChannel.progress, {
    form_id: form.id,
    client_id: form.client_id,
    status: form.status,
    answered: progress.answered,
    total: progress.total,
    ts: Date.now(),
  }).catch(e => console.error('intake realtime publish failed:', e))

  return NextResponse.json({ status: form.status })
}
