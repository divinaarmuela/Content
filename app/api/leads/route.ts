import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../lib/authz'

/** Every lead in the business.
 *
 *  Middleware only proves the caller is signed in, and clients sign in too
 *  (the /client portal). A team role is required here so a client account
 *  cannot read the agency's entire pipeline. */
export async function GET() {
  try {
    await requireRole('scheduler') // any team member; excludes `client`
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Leads fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
