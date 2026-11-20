import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Lead } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getLeadDiscovery } from '@/app/lib/lead-discovery'
import { listIntakeFiles } from '@/app/lib/intake'
import { discoveryAnswers, discoveryState, type DiscoveryRow } from '@/app/lib/lead-discovery-core'

/**
 * A LEAD'S DISCOVERY FORM, READ (the owner, 20 Nov 2026; lead-discovery.ts). The form is sent cold from one general
 * link and makes its own lead when it is sent in, so there is nothing to make or send from here:
 *
 *   GET  →  { form: null } or where the form is up to and what they answered
 *
 * WHO: the team, never a client (the same people who read the Leads page).
 */
export const dynamic = 'force-dynamic'

const DAY = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short' })

function view(form: DiscoveryRow | null, origin: string, files: { filename: string; url: string }[] = [], clientId: string | null = null) {
  if (!form) return { form: null, state: discoveryState(null) }
  return {
    form: { id: form.id, link: `${origin}/intake/${form.token}`, created_at: form.created_at ?? null, sent_at: form.sent_at ?? null, first_opened_at: form.first_opened_at ?? null, submitted_at: form.submitted_at ?? null },
    state: discoveryState(form, DAY),
    answers: discoveryAnswers(form),
    // what they uploaded, and the client it made (20 Nov 2026)
    files, client_id: clientId,
  }
}

async function guard(id: string) {
  await requireRole('scheduler') // any team member; excludes `client`
  const lead = await table<Lead>('leads').get(id)
  return lead
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const { id } = await params
      const lead = await guard(id)
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      const form = await getLeadDiscovery(id)
      const files = form ? (await listIntakeFiles(form.id)).map(f => ({ filename: f.filename, url: f.url })) : []
      return NextResponse.json(view(form, new URL(req.url).origin, files, form?.client_id || null))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
