import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { submitIntake } from '../../../../lib/intake'
import { notify, renderEmail } from '../../../../lib/mailer'
import { completion } from '../../../../lib/intake-core'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await submitIntake(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: client } = await supabase
    .from('clients').select('name').eq('id', form.client_id).maybeSingle()
  const name = client?.name ?? 'A client'
  const progress = completion(form.definition, form.answers)
  const base = process.env.NEXT_PUBLIC_APP_URL ?? ''

  // Best-effort. The answers are already saved, so a failed email must never
  // fail the client's submission — they did their part. notify() carries its
  // own dedupe key, so a double submit cannot send this twice.
  try {
    await notify({
      eventType: 'intake_submitted',
      entityType: 'intake_form',
      entityId: form.id,
      recipientEmail: process.env.GMAIL_USER ?? '',
      subject: `Intake form submitted — ${name}`,
      bodyHtml: renderEmail(
        'Intake form submitted',
        `<p>${name} has completed their ${form.template_key.replace('_', '-')} intake form ` +
        `— ${progress.answered} of ${progress.total} questions answered.</p>`,
        'Open in dashboard',
        `${base}/dashboard/clients/${form.client_id}`,
      ),
    })
  } catch (e) {
    console.error('intake submit notification failed:', e)
  }

  return NextResponse.json({ status: form.status })
}
