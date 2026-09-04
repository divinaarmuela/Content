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
 * Persisting a queue here would mean two places that both believe they know
 * what is running.
 */

export const MAX_WAITING = 2

type Task = () => Promise<void>

export class JobQueue {
  private running = false
  private waiting: { id: string; task: Task }[] = []

  /** How many jobs this machine is holding, running one included. */
  get depth(): number {
    return (this.running ? 1 : 0) + this.waiting.length
  }

  get busy(): boolean {
    return this.waiting.length >= MAX_WAITING
  }

  /** Is this job already here? A retried POST must not encode twice. */
  has(id: string): boolean {
    return this.waiting.some(w => w.id === id)
  }

  /** Accepted, or refused because the line is full. */
  add(id: string, task: Task): boolean {
    if (this.busy) return false
    this.waiting.push({ id, task })
    void this.pump()
    return true
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const next = this.waiting.shift()
    if (!next) return
    this.running = true
    try {
      await next.task()
    } catch (e) {
      // a task that throws is a bug in the task, not a reason to stop the
      // machine taking work — runEncode already reports its own failures
      console.error(`[queue ${next.id}] task threw:`, e instanceof Error ? e.message : e)
    } finally {
      this.running = false
      void this.pump()
    }
  }
}
