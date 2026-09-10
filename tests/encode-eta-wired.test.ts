import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/* ── the copies-ready gate is on BOTH ways a time is chosen (10 Sep 2026) ── */

const server = readFileSync('app/lib/social-schedule.ts', 'utf8')
const window = readFileSync('app/dashboard/social/schedule/NewPostDialog.tsx', 'utf8')

describe('a booked time waits for the copies', () => {
  it('schedulePost refuses a time before the copies are done', () => {
    const fn = server.slice(server.indexOf('export async function schedulePost('), server.indexOf('export async function', server.indexOf('export async function schedulePost(') + 10))
    expect(fn).toContain('copiesNotReadyBy(post, accounts, whenMs)')
    expect(fn).toContain('throw new ComposeError([late])')
  })
  it('reschedule — a drag on the calendar or a typed time — refuses the same way', () => {
    const fn = server.slice(server.indexOf('export async function reschedule('), server.indexOf('export async function', server.indexOf('export async function reschedule(') + 10))
    expect(fn).toContain('copiesNotReadyBy(post, await channelsFor(item.client_id, post.channels), when)')
    expect(fn).toContain("if (late) return { ok: false, error: late }")
  })
  it('the window moves its own clock to the earliest safe time, but never a booked post', () => {
    expect(window).toContain("useTable<EncodeJob>('encode_jobs')")
    expect(window).toContain('if (!beforeCopies || bookedAlready || safeAt === null || pickedTime.current) return')
    // a default set quietly — never an override of a time the person picked,
    // never an "unsaved" window (the audit of 10 Sep 2026)
    expect(window).toContain("dispatch({ type: 'time', iso: new Date(safeAt).toISOString(), quiet: true })")
  })
})
