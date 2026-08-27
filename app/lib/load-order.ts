/**
 * Which refetch is allowed to land on the screen — decided here, with no I/O.
 *
 * THE PROBLEM. Three things refetch a workflow page: a mutation finishing, the
 * realtime hint, and the 60s poll. They overlap constantly and HTTP gives no
 * ordering guarantee, so a poll issued BEFORE a save can answer AFTER it and
 * put the pre-save item straight back on screen.
 *
 * The first fix for that was a stamped sequence: only the NEWEST request issued
 * may apply its answer, everything else is discarded. That kills the stale
 * answer — and introduces a worse bug in its place. "Newest issued" is not
 * "newest applied": a transition finishes, calls load(), and the realtime hint
 * its own write produced immediately issues a second load. The first answer is
 * now discarded on arrival, and if the second one is slow, fails, 404s during a
 * redirect, or is itself superseded, NOTHING is ever applied. The screen keeps
 * the pre-transition status under a toast saying the transition worked, until
 * the person reloads by hand. Every mutation on this page produces exactly that
 * announce-then-refetch pair, which is why every transition, every claim and
 * every create looked broken while a version save — which also patches state
 * optimistically — looked fine.
 *
 * THE RULE. An answer is applied unless something FRESHER has already been
 * applied. A newer request that is still in flight does not discard it: the
 * answer is HELD, and released the moment that newer request settles without
 * applying anything. So a fresh answer can be superseded, but it can never be
 * silently lost.
 */

export type Settled<T> =
  /** apply this value now — it is the freshest thing that has arrived */
  | { apply: true; value: T }
  /** nothing to do: it is stale, or a newer request is still coming */
  | { apply: false; value?: undefined }

const DROP: Settled<never> = { apply: false }

export class LoadOrder<T> {
  /** the last ticket handed out */
  private issued = 0
  /** the highest ticket whose value actually reached the screen */
  private applied = 0
  /** tickets handed out and not yet settled */
  private pending = new Set<number>()
  /** the freshest answer that arrived while a newer request was still open */
  private held: { seq: number; value: T } | null = null

  /** Take a ticket for a request that is about to be issued. */
  begin(): number {
    const seq = ++this.issued
    this.pending.add(seq)
    return seq
  }

  /** Is any request newer than `seq` still in flight? */
  private newerPending(seq: number): boolean {
    for (const p of this.pending) if (p > seq) return true
    return false
  }

  /** Release the held answer if nothing newer is still coming. */
  private release(): Settled<T> {
    const held = this.held
    if (!held) return DROP
    if (this.newerPending(held.seq)) return DROP
    this.held = null
    if (held.seq <= this.applied) return DROP
    this.applied = held.seq
    return { apply: true, value: held.value }
  }

  /** A request answered. Says whether its value may go on screen. */
  settle(seq: number, value: T): Settled<T> {
    this.pending.delete(seq)
    // already overtaken by something fresher that landed — a stale answer
    if (seq <= this.applied) return this.release()
    if (this.newerPending(seq)) {
      // hold it: if the newer request never applies anything, this is still
      // the freshest truth we have, and losing it is the bug this exists for
      if (!this.held || this.held.seq < seq) this.held = { seq, value }
      return DROP
    }
    this.applied = seq
    // anything held is older than what we are applying now
    if (this.held && this.held.seq <= seq) this.held = null
    return { apply: true, value }
  }

  /** A request failed, 404'd, or was abandoned. May release a held answer. */
  fail(seq: number): Settled<T> {
    this.pending.delete(seq)
    return this.release()
  }
}
