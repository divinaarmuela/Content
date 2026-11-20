import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { mayOpenReports, type MonthKey } from '@/app/lib/client-report-core'
import { PRINT_CSS } from '@/app/lib/report-sheet-css'
import { drawPdf } from '@/app/lib/report-pdf-draw'
import { MAX_SHEET_CHARS, ownStyles, paperClasses, pdfDisposition, pdfFileName, pdfPageHtml } from '@/app/lib/report-pdf-core'

/**
 * THE REPORT AS A PDF FILE (the owner, 20 Nov 2026: "why is download pdf still a print"; see report-pdf-core.ts).
 *
 *   POST  json: client_id, month, sheet, styles, html_class   →  the PDF, as a download
 *
 * `sheet` is the Reports page's own print sheet (the very thing Preview shows), so the file is what the person saw.
 * A browser on the server draws it on A4 with scripts off and returns the pages.
 *
 * WHO: the same people as the report itself — super admins, and account managers for their own clients.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      if (!mayOpenReports(user.role)) throw new AuthzError('Reports are for super admins and account managers', 403)
      const j = await req.json().catch(() => null) as { client_id?: unknown; month?: unknown; sheet?: unknown; styles?: unknown; html_class?: unknown } | null
      const clientId = String(j?.client_id ?? '')
      const month = String(j?.month ?? '')
      const sheet = typeof j?.sheet === 'string' ? j.sheet : ''
      if (!clientId || !/^\d{4}-\d{2}$/.test(month) || !sheet.trim()) return NextResponse.json({ error: 'There is no report to make a PDF of yet' }, { status: 400 })
      if (sheet.length > MAX_SHEET_CHARS) return NextResponse.json({ error: 'That report is too large to make into a PDF here' }, { status: 413 })
      const ids = await accessibleClientIds(user)
      if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
      const client = await table<Client>('clients').get(clientId)
      if (!client) return NextResponse.json({ error: 'That client was not found' }, { status: 404 })

      const origin = new URL(req.url).origin
      const fileName = pdfFileName(String(client.name ?? ''), month as MonthKey)
      const html = pdfPageHtml({ sheet, css: PRINT_CSS, styles: ownStyles(j?.styles, origin), htmlClass: paperClasses(j?.html_class), origin, title: fileName.replace(/\.pdf$/, '') })

      try {
        const pdf = await drawPdf(html, origin)
        return new NextResponse(Buffer.from(pdf), {
          headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': pdfDisposition(fileName), 'Cache-Control': 'no-store' },
        })
      } catch (e) {
        console.error('[report-pdf] could not make the PDF', process.version, e)
        return NextResponse.json({ error: 'The PDF could not be made' }, { status: 502 })
      }
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
