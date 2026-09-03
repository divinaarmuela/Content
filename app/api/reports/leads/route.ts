import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ReportSetting } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { buildLeadsReportData } from '../../../lib/report-data'
import { renderLeadsReportPdf } from '../../../lib/report-pdf'
import { sendRawEmail, renderEmail } from '../../../lib/mailer'

export const maxDuration = 120

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Read report settings. Account managers see the Reports page by default,
 *  so reading must not 403 for them; changing settings stays super_admin. */
export async function GET() {
  return withRequestCache(async () => {
  try {
    await requireRole('account_manager')
    const data = await table<ReportSetting>('report_settings').get('leads_report')
    if (!data) return NextResponse.json({ error: 'Run supabase/report_settings.sql first' }, { status: 503 })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Update settings. super_admin only. */
export async function PUT(req: Request) {
  return withRequestCache(async () => {
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

    const data = await table('report_settings').update('leads_report', patch)
    if (!data) return NextResponse.json({ error: 'Run supabase/report_settings.sql first' }, { status: 503 })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Generate a report. body: { month, year, action: 'download' | 'send' }.
 *  Downloading is account_manager+; SENDING it to the configured recipients
 *  is an outbound email and stays super_admin. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const body = await req.json()
    if (body.action === 'send' && user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only a super admin can email the report' }, { status: 403 })
    }
    const month = Number(body.month)
    const year = Number(body.year)
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return NextResponse.json({ error: 'Valid month and year are required' }, { status: 400 })
    }

    const settings = await table<ReportSetting>('report_settings').get('leads_report')

    const data = await buildLeadsReportData(month, year, settings?.data_from)
    const pdf = await renderLeadsReportPdf(data)
    const filename = `md-media-leads-report-${year}-${String(month).padStart(2, '0')}.pdf`

    if (body.action === 'send') {
      const recipients: string[] = (settings?.recipients as unknown as string[] | null) ?? []
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
  })
}
