import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A BOOKED POST'S AUTOMATION IS SET IN THE OPTIONS TAB (the owner, 12 Nov 2026: "my team needs to do the automation …
 * it should just be the option tab … make sure its saved there, dont have to click many times"). Reads the source,
 * so the tab or the one-press save cannot quietly go away.
 */
const src = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')

describe('Post window: automation on a booked post', () => {
  it('the Options tab stays on a booked post that can still change', () => {
    expect(src).toContain("(!!automation && (editable || mayRecover || !!shown.automation))")
  })
  it('the box is open for typing on a booked post, not read-only', () => {
    expect(src).toContain('editable={editable || bookedAuto}')
  })
  it('one Save: off the schedule, saved with the automation, booked back for the same time', () => {
    const fn = src.slice(src.indexOf('const changeBookedAutomation'), src.indexOf('const changeBookedCover'))
    const off = fn.indexOf("action: 'edit_booked'")
    const save = fn.indexOf('automation: next')
    const back = fn.indexOf("action: 'schedule_direct'")
    expect(off).toBeGreaterThan(-1)
    expect(save).toBeGreaterThan(off)
    expect(back).toBeGreaterThan(save)
    expect(fn).toContain('scheduled_for: at')
    expect(fn).toContain('15 * 60_000') // never inside the last 15 minutes
    expect(fn).toContain('postAutomationProblem') // a half-filled box is refused before the post is touched
  })
})
