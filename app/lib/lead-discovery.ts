import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type { IntakeForm, Lead } from '@/lib/db-types'
import { resolveTemplate } from './intake'
import { logLeadEvent } from './lead-events'

/**
 * THE DISCOVERY FORM, ON A LEAD — the server half (lead-discovery-core.ts says what it means).
 *
 * ONE FORM PER LEAD, BY ITS ID. The form's id is worked out from the lead's id, so two people pressing "Make the form"
 * at once claim the same row and exactly one is written — there is no "look, then write". The form lives in
 * `intake_forms` with `lead_id` set and no client (`client_id: ''`) until the lead becomes a client.
 */

type Row = IntakeForm & { lead_id?: string | null }

/** the form's id for this lead: a UUID made from the lead's own id (always the same one) */
export function discoveryFormId(leadId: string): string {
  const h = createHash('sha256').update(`lead-discovery:${leadId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export async function getLeadDiscovery(leadId: string): Promise<Row | null> {
  const row = await table<Row>('intake_forms').get(discoveryFormId(leadId))
  return row && row.lead_id === leadId ? row : null
}

/** makes the lead's form, or hands back the one already there */
export async function makeLeadDiscovery(lead: Pick<Lead, 'id'>, by: string): Promise<Row> {
  const id = discoveryFormId(lead.id)
  const def = await resolveTemplate('discovery')
  const now = new Date().toISOString()
  const made = await table<Row>('intake_forms').claim(id, cur => (cur ? null : {
    id, created_at: now, client_id: '', lead_id: lead.id, template_key: 'discovery', definition: def,
    token: randomUUID(), status: 'draft', answers: {}, send_copy_to_client: false, created_by: by, title: def.name,
    sent_at: null, first_opened_at: null, submitted_at: null, reopened_at: null, show_on_portal: false, notify_emails: null,
  } as unknown as Row))
  if (made.claimed) {
    await logLeadEvent({ leadId: lead.id, kind: 'discovery', title: 'Discovery form made', key: `discovery-made:${id}` })
    return made.row as Row
  }
  // somebody else made it first, or it was already there: theirs is the form
  if (!made.current) throw new Error('The form could not be made')
  return made.current as Row
}

/** the link was copied to send: a draft becomes "sent" once, and the lead's timeline says so */
export async function markLeadDiscoverySent(leadId: string): Promise<Row | null> {
  const id = discoveryFormId(leadId)
  const moved = await table<Row>('intake_forms').claim(id, cur =>
    (cur && cur.lead_id === leadId && cur.status === 'draft' ? { ...cur, status: 'sent', sent_at: new Date().toISOString() } : null))
  if (moved.claimed) {
    await logLeadEvent({ leadId, kind: 'discovery', title: 'Discovery form link copied to send', key: `discovery-sent:${id}` })
    return moved.row as Row
  }
  return moved.current && (moved.current as Row).lead_id === leadId ? moved.current as Row : null
}

/** THE LEAD BECAME A CLIENT: their form goes with them, onto the client's own forms */
export async function moveLeadDiscoveryToClient(leadId: string, clientId: string): Promise<void> {
  await table<Row>('intake_forms').claim(discoveryFormId(leadId), cur =>
    (cur && cur.lead_id === leadId && !cur.client_id ? { ...cur, client_id: clientId } : null)).then(() => undefined, e => console.error('discovery form not moved to the client', e))
}
