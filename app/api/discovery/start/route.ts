import { NextResponse } from 'next/server'
import { startColdDiscovery } from '@/app/lib/lead-discovery'

/**
 * THE GENERAL DISCOVERY LINK'S "BEGIN" (the owner, 20 Nov 2026: "this is cold send … one link for anyone"):
 *   POST → { token }: this visitor's own form, which /intake/<token> then opens.
 * Public, like the website's contact form: the person is not known to us yet. It makes one empty form and nothing
 * else — a lead is only made when a form is sent in with somebody's details on it.
 */
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    return NextResponse.json(await startColdDiscovery(), { status: 201 })
  } catch (e) {
    console.error('discovery form not started', e)
    return NextResponse.json({ error: 'The form could not be opened. Please try again.' }, { status: 500 })
  }
}
