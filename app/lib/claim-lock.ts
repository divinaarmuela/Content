import 'server-only'
import { encodeKey, table } from '@/lib/db'

/**
 * A named lock for the "exactly one winner" rules that span rows.
 *
 * Most of those rules are a compare-and-set on the one row they are about:
 * an item's owner seat, a job's status, a client's profile id. A few are not
 * — "one live publish job per content item", "one shoot plan per shoot", "one
 * pending invite per email", "one primary contact per client" — because the
 * thing being made unique is a relationship ACROSS rows, and no single row
 * node can carry it. Postgres expressed those as partial unique indexes; here
 * they become one lock row per subject, taken with the same compare-and-set.
 *
 * The lock is self-healing. A holder can vanish — the job settled, the plan
 * was deleted, the invite was accepted — and a lock left standing would block
 * the subject forever, turning a race guard into a permanent refusal. So a
 * caller passes `stillHeld`, which is asked only when the lock is already
 * taken: "is that holder's claim still real?" A no takes the lock over, and
 * takes it over atomically, so two callers finding the same stale lock still
 * produce exactly one winner.
 *
 * Rows live at /mdm/tables/claim_locks/<rule>__<subject> and are never
 * migrated: the lock is live state, not history.
 */
export type ClaimLock = { id: string; holder: string; at: string }

const locks = () => table<ClaimLock>('claim_locks')
const free = (row: ClaimLock | null) => !row || !row.holder

/**
 * How long a fresh lock is believed on its own word.
 *
 * A holder takes the lock and only then writes the row it is protecting, so
 * for a moment `stillHeld` would look for something that is not there yet and
 * answer "stale" — handing the loser of the race the lock the winner is still
 * using. Inside the window a lock is simply held; the staleness question is
 * asked only of locks old enough for that gap to be closed.
 */
const YOUNG_MS = 60_000

/**
 * Take `key` for `holder`. `{ ok: false, holder }` names whoever has it.
 * Taking a lock you already hold succeeds — a double-click is not a conflict.
 */
export async function takeClaimLock(
  key: string,
  holder: string,
  stillHeld?: (heldBy: string) => Promise<boolean>,
): Promise<{ ok: true } | { ok: false; holder: string }> {
  const mine = (): ClaimLock => ({ id: key, holder, at: new Date().toISOString() })
  const first = await locks().claim(key, cur => (free(cur) ? mine() : null))
  if (first.claimed) return { ok: true }

  const held = first.current
  if (!held) return { ok: false, holder: '' }
  if (held.holder === holder) return { ok: true }
  const young = Date.parse(held.at ?? '') > Date.now() - YOUNG_MS
  if (!stillHeld || young || await stillHeld(held.holder)) return { ok: false, holder: held.holder }

  // the lock outlived what it guarded — take it over, still atomically: only
  // the claimant whose write lands on the SAME dead holder wins
  const over = await locks().claim(key, cur =>
    free(cur) || cur?.holder === held.holder ? mine() : null)
  if (over.claimed) return { ok: true }
  return { ok: false, holder: over.current?.holder ?? held.holder }
}

/**
 * Give `key` back, if it is still yours.
 *
 * Releasing empties the holder rather than deleting the row: a delete cannot
 * be made conditional on who holds it, so a late release could throw away the
 * next claimant's lock.
 */
export async function releaseClaimLock(key: string, holder: string): Promise<void> {
  await locks().claim(key, cur =>
    cur && cur.holder === holder ? { ...cur, holder: '' } : null)
}

// The keys, all in one place, so the two ends of each rule cannot drift.

/** One pending invite per email address (Postgres: a partial unique index). */
export const pendingInviteLockKey = (email: string) => `invite__${encodeKey(email.trim().toLowerCase())}`
/** One primary contact per client (Postgres: a partial unique index). */
export const primaryContactLockKey = (clientId: string) => `primary_contact__${clientId}`
/** One shoot plan per shoot (Postgres: a partial unique index). */
export const briefLockKey = (batchId: string) => `brief__${batchId}`
