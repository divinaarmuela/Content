import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Lead } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getLeadDiscovery, makeLeadDiscovery, markLeadDiscoverySent } from '@/app/lib/lead-discovery'
import { discoveryAnswers, discoveryState, type DiscoveryRow } from '@/app/lib/lead-discovery-core'

/**
 * A LEAD'S DISCOVERY FORM (the owner, 20 Nov 2026; lead-discovery-core.ts).
 *
 *   GET                    →  { form: null } or the form's link, where it is up to, and the answers so far
 *   POST                   →  makes the lead's form (or hands back the one already there)
 *   PATCH { action: sent } →  the link was copied to send: the form is marked sent, once
 *
 * WHO: the team, never a client (the same people who read the Leads page).
 */
export const dynamic = 'force-dynamic'

const DAY = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short' })

function view(form: DiscoveryRow | null, origin: string) {
  if (!form) return { form: null, state: discoveryState(null) }
  return {
    form: { id: form.id, link: `${origin}/intake/${form.token}`, created_at: form.created_at ?? null, sent_at: form.sent_at ?? null, first_opened_at: form.first_opened_at ?? null, submitted_at: form.submitted_at ?? null },
    state: discoveryState(form, DAY),
    answers: discoveryAnswers(form),
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
      return NextResponse.json(view(await getLeadDiscovery(id), new URL(req.url).origin))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const lead = await table<Lead>('leads').get(id)
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      return NextResponse.json(view(await makeLeadDiscovery(lead, user.id), new URL(req.url).origin), { status: 201 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const { id } = await params
      const lead = await guard(id)
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      const body = await req.json().catch(() => ({})) as { action?: unknown }
      if (body.action !== 'sent') return NextResponse.json({ error: 'Nothing to do' }, { status: 400 })
      const form = await markLeadDiscoverySent(id)
      if (!form) return NextResponse.json({ error: 'Make the form first' }, { status: 404 })
      return NextResponse.json(view(form, new URL(req.url).origin))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
