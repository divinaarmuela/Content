import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * ONE BUTTON, ONE ACTION, ON THE SCHEDULER PAGE.
 *
 * The owner asked for this repeatedly and did not get it: "ONE BUTTON… IT
 * SHOULD BE ONE ACTION WHERE I CAN PUT FILES OR DRIVE TO SEND TO MY AM FOR
 * APPROVAL", and then "where is this preview feature in the Scheduler page? my
 * New post is still taking me to the Schedule page."
 *
 * It went wrong twice the same way — a button that navigated to
 * `/dashboard/social/schedule?new=1`, and a second "New card" added beside it
 * — so the rule is stated as a property of the SOURCE rather than left to a
 * reviewer noticing. This file reads the files instead of importing them on
 * purpose: an import proves what the code does when it runs, and this is about
 * what the page CAN do at all.
 *
 * Comments are stripped before anything is matched, so writing down WHY the
 * Scheduler no longer sends anyone to the Schedule page cannot fail the test
 * that says it must not.
 */

const BUTTON = 'app/dashboard/scheduler/NewPostButton.tsx'
const COMPOSE = 'app/dashboard/scheduler/SendForApprovalDialog.tsx'
const LAYOUT = 'app/dashboard/scheduler/layout.tsx'
const BOARD = 'app/dashboard/scheduler/page.tsx'
const FLOW = 'app/dashboard/social/schedule/useComposeFlow.tsx'
const SCHEDULE = 'app/dashboard/social/schedule/page.tsx'

/** The code, without the prose about the code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*)/.test(line))
    .map(line => line.replace(/\s\/\/.*$/, ''))
    .join('\n')
}

describe('the Scheduler page never sends anybody to the Schedule page to post', () => {
  it('the button navigates nowhere', () => {
    const src = code(BUTTON)
    expect(src).not.toMatch(/useRouter|router\.push|redirect\(/)
    expect(src).not.toMatch(/SCHEDULE_PAGE|social\/schedule/)
    expect(src).not.toMatch(/new=1/)
  })

  it('nothing on the page routes to the Schedule page for a new post', () => {
    for (const path of [BUTTON, COMPOSE, BOARD]) {
      expect(code(path)).not.toMatch(/\?new=1/)
    }
  })

  it('the button opens the one window in place instead', () => {
    const src = code(BUTTON)
    expect(src).toMatch(/import SendForApprovalDialog from '\.\/SendForApprovalDialog'/)
    expect(src).toMatch(/\{open && <SendForApprovalDialog/)
  })
})

describe('the one window: the files and the decision, nothing else (8 Sep 2026)', () => {
  const src = code(COMPOSE)

  it('is NOT the composer: no caption, no channels, no network options, no time', () => {
    expect(src).not.toMatch(/useComposeFlow|NewPostDialog|NewPostSources|per_channel|scheduled_for/)
    expect(src).toMatch(/\/api\/social\/schedule\/from-upload/)
    expect(src).toMatch(/decision/)
  })

  it('offers the three decisions to the right people', () => {
    // somebody who needs an approval picks who — and a manager may ask
    // somebody else to check it too (10 Sep 2026)
    expect(src).toMatch(/Who checks it\?/)
    expect(src).toMatch(/Ask somebody to check it/)
    expect(src).toMatch(/send\('ask'\)/)
    // a manager approves, or sends it to the client — the "send to client thing"
    expect(src).toMatch(/send\('approve'\)/)
    expect(src).toMatch(/send\('client'\)/)
    expect(src).toMatch(/Send to \$\{client\?\.name/)
  })

  it('asks which client first, in the same window', () => {
    expect(src).toMatch(/Who is this post for\?/)
    expect(src).toMatch(/aria-label="New post"/)
    // one client to hold is no question at all
    expect(src).toMatch(/data\.clients\.length !== 1/)
  })

  it('has the client list it needs, live, rather than a second fetch', () => {
    expect(src).toMatch(/useSchedulePosts\(viewer, clientId\)/)
  })
})

describe('one flow, not two', () => {
  const flow = code(FLOW)

  it('the flow is where the chooser, the composer and the editor are drawn', () => {
    expect(flow).toMatch(/import NewPostSources from '\.\/NewPostSources'/)
    expect(flow).toMatch(/import NewPostDialog/)
    expect(flow).toMatch(/import ImageEditor/)
  })

  it('the Schedule page renders the same flow rather than its own copy', () => {
    const page = code(SCHEDULE)
    expect(page).toMatch(/useComposeFlow/)
    expect(page).toMatch(/\{flow\.windows\}/)
    // the windows themselves live in ONE file now
    expect(page).not.toMatch(/<NewPostSources|<NewPostDialog|<ImageEditor/)
  })

  it('neither page keeps a second composer, preview or approval route', () => {
    for (const path of [BUTTON, COMPOSE, BOARD]) {
      const src = code(path)
      expect(src).not.toMatch(/<NewPostDialog|<NewPostSources/)
      expect(src).not.toMatch(/PostPreview/)
      expect(src).not.toMatch(/mode: ?'approval'/)
    }
  })
})

describe('one primary button in the Post approval header', () => {
  it('the header holds exactly one <Button>, and it is New post', () => {
    const src = code(LAYOUT)
    expect(src.match(/<Button/g) ?? []).toHaveLength(0)
    expect(src.match(/<NewPostButton\s*\/>/g) ?? []).toHaveLength(1)
  })

  it('the board under it offers no second button of its own', () => {
    const src = code(BOARD)
    expect(src).not.toMatch(/<Button\b/)
    // "New card" was added and taken off this page twice; it stays off
    expect(src).not.toMatch(/New card/)
  })

  it('the button itself is one button, at 44px', () => {
    const src = code(BUTTON)
    expect(src.match(/<Button\b/g) ?? []).toHaveLength(1)
    expect(src).toMatch(/h-11/)
    expect(src).toMatch(/New post/)
  })
})
