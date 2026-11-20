import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { getIntakeFormForClient, listIntakeFiles } from '../../../../../lib/intake'
import { renderIntakePdf } from '../../../../../lib/intake-pdf'
import { normaliseDefinition, type Answers, type TemplateKey } from '../../../../../lib/intake-core'

/**
 * A FORM'S ANSWERS AS A PDF FILE, FROM THE CLIENT'S INTAKE TAB (the owner, 20 Nov 2026: "can we see the answers and
 * pdf in client intake tab too?"). The same PDF that is emailed when a form is sent in was only ever in that email;
 * the tab could only open the browser's print window. This hands the file over.
 *
 *   GET  ?form_id=…   →  the PDF, as a download
 *
 * WHO: the same people who read the Intake tab. The form is resolved THROUGH the client, so a form id belonging to
 * another client cannot be read by somebody who knows it.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      await requireRole('editor')
      const { id } = await params
      const formId = new URL(req.url).searchParams.get('form_id') ?? ''
      const form = formId ? await getIntakeFormForClient(id, formId) : null
      if (!form) return NextResponse.json({ error: 'No such form on this client' }, { status: 404 })
      const client = await table<Client>('clients').get(id)
      const name = String(client?.name ?? 'Client')
      const pdf = await renderIntakePdf({
        clientName: name,
        formTitle: form.title || 'Intake form',
        templateKey: form.template_key,
        definition: normaliseDefinition(form.definition, (form.template_key ?? 'one_off') as TemplateKey),
        answers: (form.answers ?? {}) as Answers,
        files: await listIntakeFiles(form.id),
        submittedAt: form.submitted_at ? new Date(form.submitted_at) : new Date(),
      })
      const safe = `${name} - ${form.title || 'Intake form'}`.replace(/[\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Intake form'
      const plain = safe.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${plain}.pdf"; filename*=UTF-8''${encodeURIComponent(`${safe}.pdf`)}`,
          'Cache-Control': 'no-store',
        },
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
