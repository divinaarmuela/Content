import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type { IntakeForm, Lead } from '@/lib/db-types'
import { resolveTemplate } from './intake'
import { completion, normaliseDefinition } from './intake-core'
import { logLeadEvent } from './lead-events'

/**
 * THE DISCOVERY FORM — the server half (lead-discovery-core.ts says what a form's state means).
 *
 * IT IS SENT COLD (the owner, 20 Nov 2026: "no mate this is cold send … one link for anyone"). There is one general
 * link, /discovery, pasted into any cold email or message. Nobody is set up first. Pressing Begin there makes that
 * visitor their own form (`intake_forms`, no client, no lead); when they send it in, a LEAD is made from their answers
 * and the form is tied to it (`lead_id`) — so whoever fills it in turns up on the Leads page with what they wrote.
 */

type Row = IntakeForm & { lead_id?: string | null }

const text = (v: unknown, max: number) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim().slice(0, max)

/** a visitor's own form, made when they press Begin on the general link */
export async function startColdDiscovery(): Promise<{ token: string }> {
  const def = await resolveTemplate('discovery')
  const row = await table('intake_forms').insert({
    client_id: '', template_key: 'discovery', definition: def, title: def.name,
    token: randomUUID(), status: 'sent', sent_at: new Date().toISOString(), answers: {},
  }) as unknown as Row
  return { token: row.token }
}

/** the lead a form belongs to, as its row (found by the lead, whoever made the form) */
export async function getLeadDiscovery(leadId: string): Promise<Row | null> {
  const rows = await table<Row>('intake_forms').list({ where: f => f.lead_id === leadId, limit: 1 })
  return rows[0] ?? null
}

/**
 * THE FORM WAS SENT IN: the person becomes a lead, once. The lead's id is worked out from the form's own id, so a
 * second press of Submit (or a retry) claims the same lead and writes nothing — there is no "look, then write".
 * Answers with no name, email, phone or business make no lead: there would be nobody to contact.
 */
export async function leadFromColdDiscovery(form: Row): Promise<Lead | null> {
  if (form.client_id || form.lead_id || form.template_key !== 'discovery') return null
  const a = (form.answers ?? {}) as Record<string, unknown>
  const name = text(a.primary_contact, 120)
  const email = text(a.contact_email, 200).toLowerCase()
  const phone = text(a.contact_mobile, 60)
  const biz = text(a.public_name, 200)
  if (!name && !email && !phone && !biz) return null
  const h = createHash('sha256').update(`discovery-lead:${form.id}`).digest('hex')
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
  const [fname, ...rest] = name.split(/\s+/).filter(Boolean)
  const now = new Date().toISOString()
  const made = await table<Lead>('leads').claim(id, cur => (cur ? null : {
    id, created_at: now, source: 'discovery_form',
    fname: fname ?? '', lname: rest.join(' '), email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null, phone: phone || null, biz: biz || null,
    model: text(a.services_wanted, 300) || null,
    need: [text(a.what_you_do, 1500), text(a.top_goals, 1500)].filter(Boolean).join('\n\n') || null,
    budget: text(a.budget_range, 200) || null, timeline: text(a.start_when, 200) || null,
  } as unknown as Lead))
  const lead = made.claimed ? made.row : made.current
  if (!lead) return null
  await table<Row>('intake_forms').claim(form.id, cur => (cur && !cur.lead_id ? { ...cur, lead_id: lead.id } : null))
  // THE TIMELINE'S FIRST LINE (the owner, 20 Nov 2026: "the timeline is filled when they answer"): what they did, and how much of it
  if (made.claimed) {
    const def = normaliseDefinition(form.definition, 'discovery')
    const c = completion(def, a as never)
    await logLeadEvent({ leadId: lead.id, kind: 'discovery', title: 'Filled in the discovery form', detail: `${c.answered} of ${c.total} questions answered. Their answers are on this page.`, key: `discovery-filled:${form.id}` })
  }
  return lead
}

/** THE LEAD BECAME A CLIENT: their form goes with them, onto the client's own forms */
export async function moveLeadDiscoveryToClient(leadId: string, clientId: string): Promise<void> {
  try {
    const form = await getLeadDiscovery(leadId)
    if (form) await table<Row>('intake_forms').claim(form.id, cur => (cur && cur.lead_id === leadId && !cur.client_id ? { ...cur, client_id: clientId } : null))
  } catch (e) { console.error('discovery form not moved to the client', e) }
}
