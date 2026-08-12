import 'server-only'
import { supabase } from '@/lib/supabase'
import { notify, renderEmail } from './mailer'
import { publicUrl } from './public-url'
import { canRespond, nextStatus, shootIcs, splitRecipients, type ShootStatus } from './shoot-core'
import { CAL_TZ } from './gcal-core'

/**
 * Shoot proposals — the team offers a client a date from the Availability
 * view; the client answers Yes/No on a public token page; the answer marks
 * the slot. All emails are best-effort AFTER the database write, so a mail
 * outage can never lose a proposal or an answer.
 */

export type ShootProposal = {
  id: string
  token: string
  client_id: string
  title: string
  starts_at: string
  ends_at: string
  location: string | null
  note: string | null
  send_to: string
  status: ShootStatus
  created_by: string | null
  responded_at: string | null
  clients?: { name: string } | null
}

const fmtRange = (startsAt: string, endsAt: string): string => {
  const day = new Date(startsAt).toLocaleDateString('en-AU', {
    timeZone: CAL_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', { timeZone: CAL_TZ, hour: 'numeric', minute: '2-digit' })
  return `${day}, ${t(startsAt)} – ${t(endsAt)}`
}

export async function createShootProposal(input: {
  client_id: string
  title: string
  starts_at: string
  ends_at: string
  location?: string | null
  note?: string | null
  send_to: string[]
  created_by: string
}): Promise<ShootProposal> {
  const recipients = [...new Set(input.send_to.map(e => e.trim().toLowerCase()).filter(Boolean))]
  const { data, error } = await supabase
    .from('shoot_proposals')
    .insert({
      client_id: input.client_id,
      title: input.title,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      location: input.location || null,
      note: input.note || null,
      send_to: recipients.join(', '),
      created_by: input.created_by,
    })
    .select('*, clients(name)')
    .single()
  if (error) throw new Error(error.message)
  const proposal = data as ShootProposal

  // The invitation, to every recipient. Yes and No are the same link — the
  // answer is a button press on the page, never a GET an email scanner could
  // prefetch. notify() dedupes per (event, entity, recipient), so each address
  // gets exactly one.
  await Promise.all(recipients.map(async to => {
    try {
      await notify({
        eventType: 'shoot_proposed',
        entityType: 'shoot_proposal',
        entityId: proposal.id,
        recipientEmail: to,
        subject: `Shoot proposal — ${fmtRange(proposal.starts_at, proposal.ends_at)}`,
        bodyHtml: renderEmail(
          'We have a shoot date for you',
          `<p><strong>${proposal.title}</strong></p>` +
          `<p>${fmtRange(proposal.starts_at, proposal.ends_at)}` +
          (proposal.location ? `<br>${proposal.location}` : '') + `</p>` +
          (proposal.note ? `<p>${proposal.note}</p>` : '') +
          `<p>Does this work for you? Answer with one click — yes or no, either helps us plan.</p>`,
          'Answer yes or no',
          publicUrl(`/shoot/${proposal.token}`),
        ),
      })
    } catch (e) {
      console.error(`shoot proposal email failed for ${to}:`, e)
    }
  }))

  return proposal
}

/** Proposals overlapping [from, to) — for the Availability week. */
export async function listShootProposals(from: string, to: string): Promise<ShootProposal[]> {
  const { data, error } = await supabase
    .from('shoot_proposals')
    .select('*, clients(name)')
    .lt('starts_at', to)
    .gte('ends_at', from)
    .order('starts_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as ShootProposal[]
}

/** Every proposal, newest first — the Proposals register. */
export async function listAllShootProposals(limit = 200): Promise<ShootProposal[]> {
  const { data, error } = await supabase
    .from('shoot_proposals')
    .select('*, clients(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as ShootProposal[]
}

export async function getShootByToken(token: string): Promise<ShootProposal | null> {
  const { data, error } = await supabase
    .from('shoot_proposals')
    .select('*, clients(name)')
    .eq('token', token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as ShootProposal | null
}

/**
 * Cancel a proposal. Every address it was sent to is told — silently pulling
 * a date someone accepted is how a client turns up to a shoot that is not
 * happening. The email is best-effort after the write, as everywhere else.
 */
export async function cancelShootProposal(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('shoot_proposals')
    .update({ status: 'cancelled' })
    .eq('id', id).neq('status', 'cancelled')
    .select('*, clients(name)')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return // already cancelled — nothing to announce twice
  const proposal = data as ShootProposal

  const when = fmtRange(proposal.starts_at, proposal.ends_at)
  await Promise.all(splitRecipients(proposal.send_to).map(async to => {
    try {
      await notify({
        eventType: 'shoot_cancelled_client',
        entityType: 'shoot_proposal',
        entityId: proposal.id,
        recipientEmail: to,
        subject: `Cancelled — ${proposal.title}`,
        bodyHtml: renderEmail(
          'Shoot date cancelled',
          `<p><strong>${proposal.title}</strong></p><p>${when}</p>` +
          `<p>This date is off — apologies for the change. We&rsquo;ll be in touch ` +
          `with a new one shortly.</p>`,
        ),
      })
    } catch (e) {
      console.error(`shoot cancellation email failed for ${to}:`, e)
    }
  }))
}

/**
 * The client's answer. Repeatable — plans change, the latest answer wins and
 * the team hears about every change. Returns null for an unknown token or a
 * cancelled proposal.
 */
export async function respondToShoot(
  token: string, answer: 'yes' | 'no',
): Promise<ShootProposal | null> {
  const current = await getShootByToken(token)
  if (!current || !canRespond(current.status)) return null

  const status = nextStatus(current.status, answer)
  const { data, error } = await supabase
    .from('shoot_proposals')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('token', token)
    .select('*, clients(name)')
    .single()
  if (error) throw new Error(error.message)
  const proposal = data as ShootProposal

  const team = (process.env.GMAIL_USER ?? '').toLowerCase()
  const clientName = proposal.clients?.name ?? 'The client'
  const when = fmtRange(proposal.starts_at, proposal.ends_at)

  // team heads-up — entityId varies per response so a changed answer is not
  // swallowed by the notification dedupe key
  if (team) {
    try {
      await notify({
        eventType: `shoot_${status}`,
        entityType: 'shoot_proposal',
        entityId: `${proposal.id}:${proposal.responded_at}`,
        recipientEmail: team,
        subject: status === 'accepted'
          ? `✅ ${clientName} accepted — ${proposal.title}`
          : `❌ ${clientName} declined — ${proposal.title}`,
        bodyHtml: renderEmail(
          status === 'accepted' ? 'Shoot confirmed' : 'Shoot declined',
          `<p><strong>${clientName}</strong> answered <strong>${status === 'accepted' ? 'yes' : 'no'}</strong> ` +
          `to ${proposal.title}.</p><p>${when}</p>` +
          (status === 'declined' ? '<p>Propose another date from the Availability view.</p>' : ''),
          'Open availability',
          publicUrl('/dashboard/scheduler/availability'),
        ),
        ...(status === 'accepted' ? {
          attachments: [{
            filename: 'shoot.ics',
            content: Buffer.from(shootIcs({
              uid: proposal.id,
              title: `${proposal.title} — ${clientName}`,
              startsAt: proposal.starts_at,
              endsAt: proposal.ends_at,
              location: proposal.location,
              note: proposal.note,
              organizerEmail: team,
              attendeeEmail: splitRecipients(proposal.send_to)[0] ?? proposal.send_to,
            })),
            contentType: 'text/calendar; method=REQUEST',
          }],
        } : {}),
      })
    } catch (e) {
      console.error('shoot response team email failed:', e)
    }
  }

  // confirmation + calendar file for every recipient, only on yes
  if (status === 'accepted') {
    await Promise.all(splitRecipients(proposal.send_to).map(async to => {
    try {
      await notify({
        eventType: 'shoot_confirmed_client',
        entityType: 'shoot_proposal',
        entityId: `${proposal.id}:${proposal.responded_at}`,
        recipientEmail: to,
        subject: `Locked in — ${proposal.title}`,
        bodyHtml: renderEmail(
          'Shoot confirmed',
          `<p><strong>${proposal.title}</strong></p><p>${when}` +
          (proposal.location ? `<br>${proposal.location}` : '') + `</p>` +
          `<p>The attached calendar file adds it to your calendar in one click. ` +
          `If anything changes, use your original link to update your answer.</p>`,
        ),
        attachments: [{
          filename: 'shoot.ics',
          content: Buffer.from(shootIcs({
            uid: proposal.id,
            title: `${proposal.title} — MD Media`,
            startsAt: proposal.starts_at,
            endsAt: proposal.ends_at,
            location: proposal.location,
            note: proposal.note,
            organizerEmail: team || 'hello@mdmmarketing.com.au',
            attendeeEmail: to,
          })),
          contentType: 'text/calendar; method=REQUEST',
        }],
      })
    } catch (e) {
      console.error(`shoot confirmation email failed for ${to}:`, e)
    }
    }))
  }

  return proposal
}
