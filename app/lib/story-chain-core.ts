/**
 * STORIES GO OUT IN ORDER (the owner, 5 Nov 2026: "we need to know it posted and then schedule… please no breaks").
 *
 * Two stories booked a minute apart on one account went to Zernio as two independent timed posts: if the first ran
 * late, the second could land before it, and Instagram would show them in the wrong order. Zernio has no way to say
 * "after that one" (its Queue is recurring time slots, and a story post is one picture), so the order is kept here:
 *
 *   A story with an earlier story on the SAME account within CHAIN_WINDOW_MS before it is CHAINED to that one.
 *   It is not handed to Zernio until that one is published. Then it goes — at its own time if that is still ahead,
 *   at once if its time has passed while it waited.
 *
 * Only a job still `queued` is ever held, so a booking already with Zernio (status `scheduled`) is never touched.
 * Pure — the I/O is in publish.ts.
 */

export const CHAIN_WINDOW_MS = 60 * 60 * 1000
/** a chained story whose time passed while it waited still goes, for this long after its time */
export const CHAIN_LATE_LIMIT_MS = 3 * 60 * 60 * 1000

export type ChainJob = {
  id: string
  status?: string | null
  scheduled_for?: string | null
  created_at?: string | null
  targets?: unknown
}

/** the one account a story job posts to ("instagram:123"), or null when it is not a single-account story */
export function storyAccount(job: Pick<ChainJob, 'targets'>): string | null {
  const ts = Array.isArray(job.targets) ? job.targets as { platform?: unknown; accountId?: unknown; options?: { kind?: unknown } | null }[] : []
  if (ts.length !== 1) return null
  const t = ts[0]
  if (!t || t.options?.kind !== 'story' || !t.platform || !t.accountId) return null
  return `${String(t.platform)}:${String(t.accountId)}`
}

const GONE = new Set(['failed', 'cancelled', 'canceled', 'deleted'])
const at = (j: ChainJob) => Date.parse(String(j.scheduled_for ?? ''))
const made = (j: ChainJob) => String(j.created_at ?? '')

/** is `a` before `b` in the sequence: an earlier time, or the same time and booked first */
function before(a: ChainJob, b: ChainJob): boolean {
  return at(a) < at(b) || (at(a) === at(b) && (made(a) < made(b) || (made(a) === made(b) && a.id < b.id)))
}

/** the story right before this one on the same account, within the window — or null */
export function storyPredecessor(job: ChainJob, others: readonly ChainJob[]): ChainJob | null {
  const account = storyAccount(job)
  if (!account || !Number.isFinite(at(job))) return null
  let best: ChainJob | null = null
  for (const o of others) {
    if (o.id === job.id || GONE.has(String(o.status ?? ''))) continue
    if (storyAccount(o) !== account || !Number.isFinite(at(o))) continue
    if (!before(o, job) || at(job) - at(o) > CHAIN_WINDOW_MS) continue
    if (!best || before(best, o)) best = o
  }
  return best
}

/** wait for it? Everything short of published waits — a failed one is excluded above, so the next is not stuck */
export function waitsFor(pred: ChainJob | null): boolean {
  return !!pred && pred.status !== 'published'
}

export const CHAIN_WAITING = 'Waiting for the story before it to go live, so they post in order.'
