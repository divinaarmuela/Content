import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/* ── the copies-ready gate is on BOTH ways a time is chosen (10 Sep 2026) ── */

const server = readFileSync('app/lib/social-schedule.ts', 'utf8')
const window = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')

describe('a booked time waits for the copies', () => {
  // the posting rebuild (29 Sep 2026): schedulePost and reschedule are gone; every booking (Book in, Post now,
  // change_time, book again) goes through post-stage's defaultQueuePublish, which asks bookingProblem first
  it('every booking the one writer makes refuses a time before the copies are done', () => {
    const fn = server.slice(server.indexOf('export async function bookingProblem('), server.indexOf('export function throwRefusal('))
    expect(fn).toContain('copiesNotReadyBy(')
    expect(fn).toContain('if (late) return late')
    const stage = readFileSync('app/lib/post-stage.ts', 'utf8')
    const queue = stage.slice(stage.indexOf('async function defaultQueuePublish('), stage.indexOf('await queuePublishJob(', stage.indexOf('async function defaultQueuePublish(')))
    expect(queue).toContain('const late = await schedule.bookingProblem(input.copy, input.accounts, whenMs)')
    expect(queue).toContain('if (late) return { error: late }')
  })
  it('the window moves its own clock to the earliest safe time, but never a booked post', () => {
    expect(window).toContain("useTable<EncodeJob>('encode_jobs')")
    // only while the post is a draft: a sent or booked post is read only (29 Sep 2026)
    expect(window).toContain('if (!editable || !beforeCopies || safeAt === null || pickedTime.current) return')
    // a default set quietly — never an override of a time the person picked,
    // never an "unsaved" window (the audit of 10 Sep 2026)
    expect(window).toContain("dispatch({ type: 'time', iso: new Date(safeAt).toISOString(), quiet: true })")
  })
})
