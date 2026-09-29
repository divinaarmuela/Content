import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * THE WORDS OF A BOOKED POST (Raina, 22 Sep 2026: "I wanted to edit the caption
 * of a scheduled post but I'm not able to — do I have to discard it first and
 * create a new one?").
 */
describe('a booked post is not reworded in place', () => {
  it('a booked post is not reworded in place; the window shows the frozen version and offers Edit', () => {
    // the posting rebuild (29 Sep 2026, decision 8): rewordBooked is gone from the server; an edit makes version N+1
    const s = readFileSync('app/lib/social-schedule.ts', 'utf8')
    expect(s).not.toContain('export async function rewordBooked(')
    // THE POSTING REBUILD (29 Sep 2026, the owner's decision 8): a booked post's
    // words are no longer changed in place — the window shows the frozen
    // version read only, and "Edit" (take it off the schedule, make version
    // N+1) is a footer button like every other move.
    const d = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(d).toContain('readOnly={!editable}')
    expect(d).not.toContain('bookedWords')
    expect(d).toContain('locked={locked}')
  })
})
