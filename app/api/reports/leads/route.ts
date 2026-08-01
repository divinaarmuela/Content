import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { buildLeadsReportData } from '../../../lib/report-data'
import { renderLeadsReportPdf } from '../../../lib/report-pdf'
import { sendRawEmail, renderEmail } from '../../../lib/mailer'

export const maxDuration = 120

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Read report settings. super_admin only. */
export async function GET() {
  try {
    await requireRole('super_admin')
    const { data, error } = await supabase
      .from('report_settings').select('*').eq('id', 'leads_report').maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Run supabase/report_settings.sql first' }, { status: 503 })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Update settings. super_admin only. */
export async function PUT(req: Request) {
  try {
    await requireRole('super_admin')
    const body = await req.json()
    const patch: Record<string, unknown> = {}
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (Array.isArray(body.recipients)) {
      const cleaned = [...new Set(body.recipients.map((r: string) => String(r).trim().toLowerCase()).filter(Boolean))]
      const bad = cleaned.find((r) => !EMAIL_RE.test(r as string))
      if (bad) return NextResponse.json({ error: `Invalid email: ${bad}` }, { status: 400 })
      // sanity cap — this is an internal report, never a mailing list
      if (cleaned.length > 10) {
        return NextResponse.json({ error: 'Maximum 10 report recipients' }, { status: 400 })
      }
      patch.recipients = cleaned
    }
    if (body.send_day !== undefined) {
      const d = Number(body.send_day)
      if (!Number.isInteger(d) || d < 1 || d > 28) {
        return NextResponse.json({ error: 'Send day must be 1–28' }, { status: 400 })
      }
      patch.send_day = d
    }
    if ('data_from' in body) patch.data_from = body.data_from || null

    const { data, error } = await supabase
      .from('report_settings').update(patch).eq('id', 'leads_report').select().single()
    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Generate a report. body: { month, year, action: 'download' | 'send' }.
 *  super_admin only. */
export async function POST(req: Request) {
  try {
    await requireRole('super_admin')
    const body = await req.json()
    const month = Number(body.month)
    const year = Number(body.year)
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return NextResponse.json({ error: 'Valid month and year are required' }, { status: 400 })
    }

    const { data: settings } = await supabase
      .from('report_settings').select('*').eq('id', 'leads_report').maybeSingle()

    const data = await buildLeadsReportData(month, year, settings?.data_from)
    const pdf = await renderLeadsReportPdf(data)
    const filename = `md-media-leads-report-${year}-${String(month).padStart(2, '0')}.pdf`

    if (body.action === 'send') {
      const recipients: string[] = settings?.recipients ?? []
      if (recipients.length === 0) {
        return NextResponse.json({ error: 'Add at least one recipient in the report settings first' }, { status: 400 })
      }
      await sendRawEmail({
        to: recipients,
        subject: `Leads report — ${data.monthLabel}`,
        html: renderEmail(
          `Leads report — ${data.monthLabel}`,
          `<p><strong>${data.totals.leads}</strong> leads this period — ` +
          `${data.totals.fromForm} from the website form, ${data.totals.fromInbox} from the inbox scanner, ` +
          `and <strong>${data.totals.prospectsCreated}</strong> new prospects created. Full detail attached.</p>`
        ),
        attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
      })
      return NextResponse.json({ sent: true, recipients, totals: data.totals })
    }

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
