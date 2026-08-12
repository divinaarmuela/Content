import 'server-only'
import { supabase } from '@/lib/supabase'
import { notify, renderEmail } from './mailer'
import { publicUrl } from './public-url'
import { canRespond, nextStatus, shootIcs, type ShootStatus } from './shoot-core'
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
  send_to: string
  created_by: string
}): Promise<ShootProposal> {
  const { data, error } = await supabase
    .from('shoot_proposals')
    .insert({
      client_id: input.client_id,
      title: input.title,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      location: input.location || null,
      note: input.note || null,
      send_to: input.send_to.toLowerCase(),
      created_by: input.created_by,
    })
    .select('*, clients(name)')
    .single()
  if (error) throw new Error(error.message)
  const proposal = data as ShootProposal

  // The invitation. Yes and No are the same link — the answer is a button
  // press on the page, never a GET an email scanner could prefetch.
  try {
    await notify({
      eventType: 'shoot_proposed',
      entityType: 'shoot_proposal',
      entityId: proposal.id,
      recipientEmail: proposal.send_to,
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
    console.error('shoot proposal email failed:', e)
  }

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

export async function getShootByToken(token: string): Promise<ShootProposal | null> {
  const { data, error } = await supabase
    .from('shoot_proposals')
    .select('*, clients(name)')
    .eq('token', token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as ShootProposal | null
}

export async function cancelShootProposal(id: string): Promise<void> {
  const { error } = await supabase
    .from('shoot_proposals').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw new Error(error.message)
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
          publicUrl('/dashboard/scheduler?view=availability'),
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
              attendeeEmail: proposal.send_to,
            })),
            contentType: 'text/calendar; method=REQUEST',
          }],
        } : {}),
      })
    } catch (e) {
      console.error('shoot response team email failed:', e)
    }
  }

  // confirmation + calendar file for the client, only on yes
  if (status === 'accepted') {
    try {
      await notify({
        eventType: 'shoot_confirmed_client',
        entityType: 'shoot_proposal',
        entityId: `${proposal.id}:${proposal.responded_at}`,
        recipientEmail: proposal.send_to,
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
            attendeeEmail: proposal.send_to,
          })),
          contentType: 'text/calendar; method=REQUEST',
        }],
      })
    } catch (e) {
      console.error('shoot confirmation email failed:', e)
    }
  }

  return proposal
}
