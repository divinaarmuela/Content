/**
 * TODAY ON POST APPROVAL (the owner, 4 Nov 2026: "whats going out today, need
 * approval or whats scheduled, who did it, what fetch from zernio … descending
 * order"). Pure: the route gathers the rows, this decides what each one says.
 */

export const TODAY_ZONE = 'Australia/Melbourne'

/** "2026-11-04" — the calendar day an instant falls on, in Melbourne. */
export function dayIn(iso: string | null | undefined, zone = TODAY_ZONE): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export type ZernioPlatform = { platform: string; status: string; url?: string | null; error?: string | null }

export type TodayState = {
  /** short words for the chip */
  label: string
  tone: 'red' | 'amber' | 'blue' | 'ink' | 'muted'
  /** something a person still has to do before it can go */
  needsAction: boolean
}

const BEFORE_APPROVAL = new Set(['draft', 'quality_check', 'with_client'])

/**
 * One post's state, Zernio first: what Zernio says beats what we last wrote,
 * because Zernio is the one that actually posts it.
 */
export function todayState(input: {
  stage: string | null | undefined
  jobStatus?: string | null
  zernio?: { status?: string | null; platforms?: ZernioPlatform[] } | null
  at: string | null
  now: Date
  /** the post waits on the client (post-stage-core): `waiting` = booked, comes off 15 minutes before its time unless
   *  they approve; `held` = it already came off because they did not. Never "Approved" — the client has not. */
  client?: 'waiting' | 'held' | null
}): TodayState {
  const { stage, jobStatus, zernio, at, now } = input
  const plats = zernio?.platforms ?? []
  const failed = plats.filter(p => /fail|error/i.test(p.status)).length
  const live = plats.filter(p => /publish|posted|live/i.test(p.status)).length
  if (failed > 0) return { label: live > 0 ? `Failed on ${failed} of ${plats.length}` : 'Failed', tone: 'red', needsAction: true }
  if (zernio?.status && /fail|error/i.test(zernio.status)) return { label: 'Failed', tone: 'red', needsAction: true }
  if (plats.length > 0 && live === plats.length) return { label: 'Posted', tone: 'ink', needsAction: false }
  if (stage === 'posted' || jobStatus === 'published') return { label: 'Posted', tone: 'ink', needsAction: false }
  if (jobStatus === 'failed') return { label: 'Failed', tone: 'red', needsAction: true }
  if (stage === 'cancelled') return { label: 'Cancelled', tone: 'muted', needsAction: false }
  const late = at !== null && new Date(at).getTime() < now.getTime() - 10 * 60_000
  if (stage && BEFORE_APPROVAL.has(stage)) {
    const words = stage === 'with_client' ? 'Waiting on client' : stage === 'quality_check' ? 'Needs quality check' : 'Draft — needs approval'
    return { label: late ? `${words} · time passed` : words, tone: late ? 'red' : 'amber', needsAction: true }
  }
  if (input.client === 'held') return { label: 'Taken off — client has not approved', tone: 'red', needsAction: true }
  if (stage === 'ready') return { label: late ? 'Approved, never booked' : 'Approved — needs Book in', tone: late ? 'red' : 'amber', needsAction: true }
  if (late) return { label: 'Should be out — not confirmed yet', tone: 'amber', needsAction: false }
  if (input.client === 'waiting') return { label: 'Scheduled — waiting for client', tone: 'amber', needsAction: false }
  return { label: 'Scheduled', tone: 'blue', needsAction: false }
}

/** "Carousel" / "Story" / "Reel" — what this post is on a platform. */
export function kindWord(input: { stated?: string | null; images: number; videos: number; platform: string }): string {
  const s = (input.stated ?? '').toLowerCase()
  if (s.includes('story')) return 'Story'
  if (s.includes('reel')) return 'Reel'
  if (s.includes('carousel')) return 'Carousel'
  if (input.images + input.videos > 1) return 'Carousel'
  if (input.videos === 1) return input.platform === 'instagram' ? 'Reel' : 'Video'
  if (input.images === 1) return 'Post'
  return 'Text'
}

/** latest time first — the owner asked for descending order */
export function newestFirst<T extends { at: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
}
