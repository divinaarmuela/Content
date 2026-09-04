import { describe, expect, it } from 'vitest'
import { JobQueue, MAX_WAITING } from '../src/queue.js'

/**
 * One running, two waiting, and the third caller told so.
 *
 * The rule this file exists for is `has()` covering the RUNNING job. Without
 * it, a re-POST of the job in flight — an Inngest step retry, or a response
 * lost after the machine had already accepted it — queued the same encode
 * behind itself: twenty minutes of CPU wasted, two PUTs to one presigned URL,
 * and a real job turned away with a 503 because a three-deep queue was full
 * of one job twice.
 */

/** A task that does not finish until it is told to. */
function held() {
  let release!: () => void
  const done = new Promise<void>(r => { release = r })
  let started = false
  return {
    release,
    started: () => started,
    task: async () => { started = true; await done },
  }
}

const tick = () => new Promise(r => setTimeout(r, 0))

describe('the line', () => {
  it('takes one running and two waiting, and refuses the fourth', () => {
    const q = new JobQueue()
    const a = held(), b = held(), c = held()
    expect(q.add('a', a.task)).toBe(true)
    expect(q.add('b', b.task)).toBe(true)
    expect(q.add('c', c.task)).toBe(true)
    // a is running, b and c wait — MAX_WAITING is full
    expect(q.depth).toBe(3)
    expect(q.busy).toBe(true)
    expect(q.add('d', held().task)).toBe(false)
    expect(MAX_WAITING).toBe(2)
    a.release(); b.release(); c.release()
  })

  it('runs them one at a time, in order', async () => {
    const q = new JobQueue()
    const a = held(), b = held()
    q.add('a', a.task)
    q.add('b', b.task)
    await tick()
    expect(a.started()).toBe(true)
    expect(b.started()).toBe(false)          // not until a is done
    expect(q.running).toBe('a')

    a.release()
    await tick(); await tick()
    expect(b.started()).toBe(true)
    expect(q.running).toBe('b')
    b.release()
  })

  it('knows about the job it is encoding right now, not only the queue', async () => {
    const q = new JobQueue()
    const a = held()
    q.add('a', a.task)
    await tick()
    expect(q.running).toBe('a')
    // the whole point: a re-POST of the running job must be recognised
    expect(q.has('a')).toBe(true)
    expect(q.has('b')).toBe(false)
    a.release()
  })

  it('knows about a job still waiting, too', () => {
    const q = new JobQueue()
    const a = held(), b = held()
    q.add('a', a.task)
    q.add('b', b.task)
    expect(q.has('b')).toBe(true)
    a.release(); b.release()
  })

  it('forgets a job once it is over, so the same file can be encoded again', async () => {
    const q = new JobQueue()
    const a = held()
    q.add('a', a.task)
    await tick()
    a.release()
    await tick(); await tick()
    expect(q.has('a')).toBe(false)
    expect(q.depth).toBe(0)
    expect(q.running).toBeNull()
  })

  it('keeps taking work after a task throws', async () => {
    const q = new JobQueue()
    let ran = false
    q.add('boom', async () => { throw new Error('bad') })
    q.add('next', async () => { ran = true })
    await tick(); await tick(); await tick()
    expect(ran).toBe(true)
    expect(q.depth).toBe(0)
  })
})
