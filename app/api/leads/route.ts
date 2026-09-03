import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Lead } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../lib/authz'

/** Every lead in the business.
 *
 *  Middleware only proves the caller is signed in, and clients sign in too
 *  (the /client portal). A team role is required here so a client account
 *  cannot read the agency's entire pipeline. */
export async function GET() {
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler') // any team member; excludes `client`
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  try {
    const data = await table<Lead>('leads').list({ orderBy: [['created_at', 'desc']] })
    return NextResponse.json(data)
  } catch (e) {
    console.error('Leads fetch error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  })
}
