/**
 * Coalesce rapid edits into one save — pure, timer-injectable, no I/O.
 *
 * The shot list used to PATCH the whole array on every tick, rename and
 * delete, and each action waited on the network before the screen moved. A
 * coalescer takes every value as it happens, keeps only the LATEST, and hands
 * it to the saver once the typing pauses — so ten quick edits cost one
 * request, and the screen never waits for any of them.
 */

export type Coalescer<T> = {
  /** record the newest value; (re)starts the quiet-period timer */
  push: (value: T) => void
  /** save NOW whatever is pending (a blur, a route change) — no-op when clean */
  flush: () => void
  /** drop the pending value and timer without saving (an unmount after flush) */
  cancel: () => void
}

export function createCoalescer<T>(
  save: (latest: T) => void,
  delayMs = 600,
  timers: {
    set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
    clear: (t: ReturnType<typeof setTimeout>) => void
  } = { set: (fn, ms) => setTimeout(fn, ms), clear: t => clearTimeout(t) },
): Coalescer<T> {
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const fire = () => {
    if (!pending) return
    const { value } = pending
    pending = null
    timer = null
    save(value)
  }
  return {
    push(value: T) {
      pending = { value }
      if (timer) timers.clear(timer)
      timer = timers.set(fire, delayMs)
    },
    flush() {
      if (timer) { timers.clear(timer); timer = null }
      fire()
    },
    cancel() {
      if (timer) { timers.clear(timer); timer = null }
      pending = null
    },
  }
}
