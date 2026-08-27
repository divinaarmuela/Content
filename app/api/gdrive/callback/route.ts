import { NextResponse } from 'next/server'
import { requireRole } from '../../../lib/authz'
import { completeDriveConnect } from '../../../lib/gdrive'

/**
 * Where Google sends them back — always onward to the Integrations page with
 * a short result in the query string, never a raw JSON body. Whoever lands
 * here has just been through Google's own sign-in; the role check is still
 * made, because a callback URL is a URL anyone can visit.
 */
export const dynamic = 'force-dynamic'

const INTEGRATIONS = '/dashboard/settings/integrations'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const back = (status: string, detail?: string) =>
    NextResponse.redirect(new URL(
      `${INTEGRATIONS}?gdrive=${status}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`,
      url.origin,
    ))

  if (url.searchParams.get('error')) return back('error', url.searchParams.get('error_description') ?? undefined)
  const code = url.searchParams.get('code')
  if (!code) return back('error', 'Google sent no authorisation code')

  try {
    const user = await requireRole('super_admin')
    const result = await completeDriveConnect(req, code, user.email)
    if (!result.ok) {
      console.error('[gdrive] connect failed', result.reason, result.detail)
      return back('error', result.detail ? `${result.message}: ${result.detail}` : result.message)
    }
    return back('ok', result.email)
  } catch (e) {
    return back('error', e instanceof Error ? e.message : undefined)
  }
}
