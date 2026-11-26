import { clientMayDecide, clientSees, dayWords, melbourneInput, seatCount, type Campaign, type CampaignCreator, type CreatorStage } from './creator-campaign-core'

/**
 * WHAT A CLIENT IS HANDED about a creator campaign, and the words on their page. Pure. The client is given only
 * what is theirs to read: never an idea the team has not shown them, never a creator who declined, never the rate
 * the agency agreed with a creator, never who on the team decided what.
 */

export type ClientCreator = {
  id: string; name: string; photo_url: string | null
  instagram: string | null; instagram_followers: number | null
  tiktok: string | null; tiktok_followers: number | null
  why: string | null; terms: 'gifted' | 'paid'; samples: string[]
  /** pictures of their posts */
  sample_images: string[]
  stage: CreatorStage; client_note: string | null; rev: number
}

const forClient = (c: CampaignCreator): ClientCreator => ({
  id: c.id, name: c.name, photo_url: c.photo_url, instagram: c.instagram, instagram_followers: c.instagram_followers,
  tiktok: c.tiktok, tiktok_followers: c.tiktok_followers, why: c.why, terms: c.terms, samples: c.samples ?? [], sample_images: c.sample_images ?? [],
  stage: c.stage, client_note: c.client_note, rev: c.rev,
})

/** One step of "where it is up to": done, where things are now, or still to come. */
export type ClientStep = { key: 'choose' | 'closes' | 'day'; label: string; when: string | null; state: 'done' | 'now' | 'next' }

export type ClientCampaign = {
  id: string; title: string; kind: Campaign['kind']
  /** the picture across the top, or null */
  cover_url: string | null
  steps: ClientStep[]
  starts_at: string | null; place: string | null; closes_on: string | null
  deliverables: string[]; usage_terms: string | null
  seats: number | null; confirmed: number; waiting: number; open: number | null
  /** more creators confirmed than there are seats */
  over: boolean
  /** may the client still answer, and if not, why */
  open_for_answers: boolean; closed_reason: string | null
  shortlist: ClientCreator[]; passed: ClientCreator[]; chosen: ClientCreator[]
  next_step: string
}

/** The whole of a client's campaign page, or null when it is not theirs to see yet. `today` is YYYY-MM-DD. */
export function clientCampaign(c: Campaign, creators: readonly CampaignCreator[], today: string): ClientCampaign | null {
  const view = clientSees(c, creators)
  if (!view) return null
  const counts = seatCount(c, creators)
  const may = clientMayDecide(c, today)
  const n = view.shortlist.length
  const next = !may.ok ? (c.status === 'closed' ? 'This list is closed.' : may.reason + '.')
    : n > 0 ? `${n} ${n === 1 ? 'creator' : 'creators'} to look at.`
      : view.confirmed.length > 0 ? 'Nothing waiting on you. We will add more creators here if we find them.'
        : 'No creators to look at yet. We will put them here.'
  // WHERE IT IS UP TO — choosing, the list closing, the day itself; only the steps the team has dated
  const day = c.starts_at ? melbourneInput(c.starts_at).slice(0, 10) : ''
  const closed = !!c.closes_on && today > c.closes_on
  const steps: ClientStep[] = [
    { key: 'choose', label: 'Choosing creators', when: c.closes_on ? `Until ${dayWords(c.closes_on)}` : null, state: may.ok && !(day && today >= day) ? 'now' : 'done' },
    ...(c.closes_on ? [{ key: 'closes' as const, label: 'The list closes', when: dayWords(c.closes_on), state: closed ? 'done' as const : 'next' as const }] : []),
    ...(day ? [{ key: 'day' as const, label: c.kind === 'event' ? 'The day' : 'Content goes out', when: dayWords(day), state: today > day ? 'done' as const : today === day ? 'now' as const : 'next' as const }] : []),
  ]
  return {
    cover_url: c.cover_url ?? null, steps,
    id: c.id, title: c.title, kind: c.kind, starts_at: c.starts_at, place: c.place, closes_on: c.closes_on,
    deliverables: c.deliverables ?? [], usage_terms: c.usage_terms,
    seats: counts.seats, confirmed: counts.confirmed, waiting: counts.waiting, open: counts.open, over: counts.over,
    open_for_answers: may.ok, closed_reason: may.ok ? null : next,
    shortlist: view.shortlist.map(forClient), passed: view.passed.map(forClient), chosen: view.confirmed.map(forClient),
    next_step: next,
  }
}

/** "8 of 10 seats confirmed · 1 waiting on their yes · 1 open" */
export function seatLine(c: Pick<ClientCampaign, 'seats' | 'confirmed' | 'waiting' | 'open' | 'over'>): string {
  return [
    // more confirmed than seats is said as it is, never as "11 of 10"
    c.seats === null ? `${c.confirmed} confirmed` : c.over ? `${c.confirmed} confirmed for ${c.seats} seats` : `${c.confirmed} of ${c.seats} seats confirmed`,
    c.waiting > 0 ? `${c.waiting} waiting on their yes` : null,
    c.open !== null && c.open > 0 ? `${c.open} open` : null,
  ].filter(Boolean).join(' · ')
}

/** Where a creator the client said yes to has got to, in plain words. */
export function chosenWords(c: Pick<ClientCreator, 'stage' | 'name'>): string {
  const first = c.name.trim().split(/\s+/)[0] || 'them'
  if (c.stage === 'confirmed') return 'Place confirmed'
  if (c.stage === 'invited') return `Invited. Waiting on ${first}`
  return 'You said yes. We are inviting them'
}

export const closesWords = (closesOn: string | null): string | null => (closesOn ? dayWords(closesOn) : null)
