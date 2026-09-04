/**
 * One job at a time, and a short line behind it.
 *
 * ffmpeg at `-preset medium` will use every core it is given, so two encodes
 * on a 2-CPU machine do not go twice as fast — they go half as fast each and
 * double the peak memory, which on a 2 GB box is how the process gets killed.
 * So: one running, at most two waiting, and the third caller is told "busy"
 * rather than being queued behind twenty minutes of work it does not know
 * about. Fly starts another machine, or the app asks again.
 *
 * The queue is in memory on purpose. A machine that dies loses its queue, and
 * that is the honest behaviour: the app owns the job rows and will ask again.
 *
 * ── The running job is part of the queue ──
 *
 * `has()` covers the job being encoded RIGHT NOW as well as the ones waiting.
 * It did not, and a re-POST of the job in flight — an Inngest step retry, or a
 * response lost after the machine had already accepted it — queued the same
 * encode behind itself: twenty minutes of CPU wasted, two PUTs to the same
 * presigned URL, and a real job turned away with a 503 because a three-deep
 * queue was full of one job twice.
 */

export const MAX_WAITING = 2

type Task = () => Promise<void>

export class JobQueue {
  private runningId: string | null = null
  private waiting: { id: string; task: Task }[] = []

  /** How many jobs this machine is holding, running one included. */
  get depth(): number {
    return (this.runningId ? 1 : 0) + this.waiting.length
  }

  /** The job being encoded right now, if any. */
  get running(): string | null {
    return this.runningId
  }

  get busy(): boolean {
    return this.waiting.length >= MAX_WAITING
  }

  /** Is this job already here — running, or waiting to run? */
  has(id: string): boolean {
    return this.runningId === id || this.waiting.some(w => w.id === id)
  }

  /** Accepted, or refused because the line is full. */
  add(id: string, task: Task): boolean {
    if (this.busy) return false
    this.waiting.push({ id, task })
    void this.pump()
    return true
  }

  private async pump(): Promise<void> {
    if (this.runningId) return
    const next = this.waiting.shift()
    if (!next) return
    this.runningId = next.id
    try {
      await next.task()
    } catch (e) {
      // a task that throws is a bug in the task, not a reason to stop the
      // machine taking work — runEncode already reports its own failures
      console.error(`[queue ${next.id}] task threw:`, e instanceof Error ? e.message : e)
    } finally {
      this.runningId = null
      void this.pump()
    }
  }
}

/**
 * Should this machine stop itself?
 *
 * Pure, because it is the fix for the most serious thing the review found and
 * a rule nothing exercises is a rule nobody can trust. `server.ts` reads the
 * clock and the queue; the decision is here.
 *
 * Two conditions, and both must hold: the queue is EMPTY — which counts the
 * job being encoded, so this can never fire mid-encode — and it has been empty
 * long enough that no follow-on work is coming. Fly's own auto-stop cannot see
 * either, which is why it is off (see fly.toml).
 */
export function shouldExit(queueDepth: number, idleSince: number, now: number, idleMs: number): boolean {
  if (queueDepth > 0) return false
  return now - idleSince >= idleMs
}
