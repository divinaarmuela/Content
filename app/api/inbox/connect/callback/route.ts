import { NextResponse } from 'next/server'
import { requireRole } from '../../../../lib/authz'
import { completeInboxConnect } from '../../../../lib/inbox-connect'

/**
 * Where Google sends them back.
 *
 * Always redirects to the scanner settings page with a short result in the
 * query string — a JSON body here would leave someone staring at raw output
 * after clicking "Allow".
 */
export const dynamic = 'force-dynamic'

const SETTINGS = '/dashboard/settings?tab=scanner'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const back = (status: string, detail?: string) =>
    NextResponse.redirect(new URL(
      `${SETTINGS}&inbox=${status}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`,
      url.origin,
    ))

  if (url.searchParams.get('error')) return back('denied')
  const code = url.searchParams.get('code')
  if (!code) return back('denied')

  try {
    const user = await requireRole('editor')
    const result = await completeInboxConnect(req, code, user.email)
    if (!result.ok) return back(result.reason)
    return back('connected', result.email)
  } catch {
    return back('unauthorised')
  }
}
