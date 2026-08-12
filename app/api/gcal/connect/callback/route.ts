import { NextResponse } from 'next/server'
import { requireRole } from '../../../../lib/authz'
import { completeCalendarConnect } from '../../../../lib/gcal'

/** Where Google sends them back — always onward to the Availability view with
 *  a short result in the query string, never a raw JSON body. */
export const dynamic = 'force-dynamic'

const AVAILABILITY = '/dashboard/scheduler/availability'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const back = (status: string, detail?: string) =>
    NextResponse.redirect(new URL(
      `${AVAILABILITY}?cal=${status}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`,
      url.origin,
    ))

  if (url.searchParams.get('error')) return back('denied')
  const code = url.searchParams.get('code')
  if (!code) return back('denied')

  try {
    const user = await requireRole('editor')
    const result = await completeCalendarConnect(req, code, user.email)
    if (!result.ok) return back(result.reason, result.detail)
    return back('connected', result.email)
  } catch {
    return back('error')
  }
}
