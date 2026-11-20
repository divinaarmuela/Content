import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, Lead, TeamUser } from '@/lib/db-types'
import { leadFormName } from '../../../../lib/lead-discovery-core'
import { logLeadEvent } from '../../../../lib/lead-events'
import {
  submitIntake, getIntakeDefaultRecipients, listIntakeFiles,
} from '../../../../lib/intake'
import { notify, renderEmail } from '../../../../lib/mailer'
import { completion, resolveRecipients } from '../../../../lib/intake-core'
import { renderIntakePdf } from '../../../../lib/intake-pdf'
import { packIntakeFiles } from '../../../../lib/intake-attachments'
import { inngest } from '../../../../inngest/client'
import { announceAfter } from '@/lib/live'
import { mirrorIntakeFiles } from '../../../../lib/gdrive-mirror'
import { previewVideos } from '../../../../lib/stream'

export const dynamic = 'force-dynamic'
// Building the PDF and pulling attachments out of storage takes longer than a
// default serverless slice allows for a form with a folder of brand assets.
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
 return withRequestCache(async () => {
  const { token } = await params
  const form = await submitIntake(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A LEAD'S DISCOVERY FORM (20 Nov 2026) has no client: it is named for the lead, its email opens the lead's page,
  // and the client-only steps below (their Drive folder, filling their record) are skipped
  const leadId = (form as { lead_id?: string | null }).lead_id ?? null
  const client = form.client_id ? await table<Client>('clients').get(form.client_id) : null
  const lead = !client && leadId ? await table<Lead>('leads').get(leadId).catch(() => null) : null
  const forLead = !!lead
  const name = client?.name ?? (leadFormName(lead) || (forLead ? 'A lead' : 'A client'))
  const progress = completion(form.definition, form.answers)
  // An email link must be absolute. NEXT_PUBLIC_APP_URL is set in production;
  // VERCEL_URL covers previews; the domain is the last resort.
  const base =
    process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    ?? 'https://www.mdmmarketing.com.au'

  // Who hears about it: this form's own list, else the agency default, else
  // the sending mailbox — so a submission is never silently unannounced.
  const recipients = resolveRecipients(
    form.notify_emails,
    await getIntakeDefaultRecipients(),
    process.env.GMAIL_USER ?? '',
  )
  if (lead) {
    // whoever owns the lead hears too
    const owner = lead.owner_id ? await table<TeamUser>('team_users').get(lead.owner_id).catch(() => null) : null
    const email = String(owner?.email ?? '').trim().toLowerCase()
    if (email && owner?.active_status !== false && !recipients.includes(email)) recipients.push(email)
    await logLeadEvent({ leadId: lead.id, kind: 'discovery', title: 'Filled in the discovery form', detail: `${progress.answered} of ${progress.total} questions answered`, key: `discovery-filled:${form.id}:${form.submitted_at ?? ''}` })
  }

  // Everything below is best-effort. The answers are already saved and the
  // client has done their part, so a failed PDF, a missing attachment or a
  // bounced email must never turn a successful submission into an error they
  // see. notify() carries its own dedupe key, so a retry cannot double-send.
  // What the client sent goes into their Drive folder: brand material to
  // `_Brand`, everything else to `_From client/{the day it arrived}`. On
  // SUBMIT, not on upload — the upload route only signs a URL, and the bytes
  // arrive from the browser afterwards, so a mirror queued there would race
  // the file into existence and spend its retries fetching a 404.
  if (!forLead) try {
    const labels = new Map<string, string>()
    for (const section of form.definition.sections) {
      for (const block of section.blocks) labels.set(block.id, block.label ?? '')
    }
    const submitted = await listIntakeFiles(form.id)
    mirrorIntakeFiles(
      form.client_id,
      submitted.map(f => ({ ...f, label: labels.get(f.block_id) ?? null })),
      new Date().toISOString(),
    )
    // a client's own phone footage is the likeliest thing in the whole system
    // to be HEVC — that is what an iPhone records by default. Queued on
    // SUBMIT for the same reason the mirror is: the sign step only hands out
    // a URL, and the bytes arrive from the browser afterwards.
    previewVideos(submitted.map(f => f.url))
  } catch (e) {
    console.error('intake drive mirror failed:', e)
  }

  try {
    const files = await listIntakeFiles(form.id)
    const [pdf, packed] = await Promise.all([
      renderIntakePdf({
        clientName: name,
        formTitle: form.title || 'Intake form',
        templateKey: form.template_key,
        definition: form.definition,
        answers: form.answers,
        files,
        submittedAt: new Date(),
      }),
      packIntakeFiles(files),
    ])

    const safeName =
      name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'client'

    const attachedList = packed.attachments.length > 0
      ? `<p style="margin:14px 0 0"><strong>Their files, attached:</strong> ${
          packed.attachments.map(a => a.filename).join(', ')}</p>`
      : ''
    const linkedList = packed.linked.length > 0
      ? `<p style="margin:14px 0 0"><strong>Too big to attach — download:</strong><br>${
          packed.linked.map(l =>
            `<a href="${l.url}">${l.filename}</a> <span style="color:#71717a">(${l.reason})</span>`,
          ).join('<br>')}</p>`
      : ''

    await Promise.all(recipients.map(to => notify({
      eventType: 'intake_submitted',
      entityType: 'intake_form',
      entityId: form.id,
      recipientEmail: to,
      subject: forLead ? `Discovery form filled in — ${name}` : `Intake form submitted — ${name}`,
      bodyHtml: renderEmail(
        forLead ? 'Discovery form filled in' : 'Intake form submitted',
        `<p>${name} has completed their ${forLead ? 'discovery form' : `${form.template_key.replace('_', '-')} intake form`} ` +
        `— ${progress.answered} of ${progress.total} questions answered. ` +
        `The full brief is attached as a PDF.</p>${attachedList}${linkedList}`,
        forLead ? 'Open the lead' : 'Open in dashboard',
        forLead ? `${base}/dashboard/leads/${lead!.id}` : `${base}/dashboard/clients/${form.client_id}/intake/${form.id}`,
      ),
      attachments: [
        { filename: `${safeName}-intake.pdf`, content: pdf, contentType: 'application/pdf' },
        ...packed.attachments,
      ],
    })))
  } catch (e) {
    console.error('intake submit notification failed:', e)
  }

  // Enrich the client from what they just told us — fill their primary contact
  // and brand profile where those are still empty. Best-effort and off-request:
  // a background Inngest function does the work (it may make a Haiku call), so a
  // failure here can never delay or break the submission. The event is dropped
  // silently until the function is synced into Inngest Cloud (CLAUDE.md trap 5b).
  if (!forLead) try {
    await inngest.send({
      name: 'app/intake.enrich.requested',
      data: { form_id: form.id, client_id: form.client_id },
    })
  } catch (e) {
    console.error('intake enrich dispatch failed:', e)
  }

  announceAfter('intake', {
    form_id: form.id,
    client_id: form.client_id,
    status: form.status,
    answered: progress.answered,
    total: progress.total,
  })

  return NextResponse.json({ status: form.status })
 })
}
