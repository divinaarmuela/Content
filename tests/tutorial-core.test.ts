import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clampStep, shouldOpenTutorial, tutorialFor, tutorialKey } from '../app/lib/tutorial-core'
import { NAV_MAIN, NAV_SOCIAL_CHILDREN, NAV_TOOLS, PAGE_TITLES } from '../app/dashboard/ui/Shell'
import { BOARD_COLUMNS } from '../app/lib/board-core'
import { SEND_FOR_REVIEW } from '../app/lib/schedule-compose-core'
import type { Role } from '../app/lib/identity-core'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/**
 * THE TUTORIAL SAYS WHAT THE SCREEN SAYS.
 *
 * The owner asked for a proper tutorial that tells a new hire what they are
 * looking at and what to press. Its worth is exactly the accuracy of the
 * words in it: "press New post" is help only while the button reads New
 * post. So every label the tutorial quotes is checked here against the
 * source that draws it, and a rename fails this file rather than a new
 * scheduler's first day.
 */
const ROLES: Role[] = ['scheduler', 'editor', 'general', 'account_manager', 'super_admin']
const everyLine = (role: Role) => {
  const t = tutorialFor(role)!
  return [t.job, t.intro, ...t.steps.flatMap(s => [s.title, ...s.see, ...s.actions, s.result ?? ''])].join('\n')
}

describe('who gets a tutorial', () => {
  it('every team role, and not a client', () => {
    for (const r of ROLES) expect(tutorialFor(r)).not.toBeNull()
    expect(tutorialFor('client')).toBeNull()
    expect(tutorialFor(null)).toBeNull()
  })

  it('a super admin and an account manager get the same one — they do the same job here', () => {
    expect(tutorialFor('super_admin')).toBe(tutorialFor('account_manager'))
  })

  it('opens by itself for a scheduler’s first sign-in, and not after', () => {
    expect(tutorialKey('scheduler')).toBe('scheduler:start')
    expect(shouldOpenTutorial('scheduler', [])).toBe(true)
    expect(shouldOpenTutorial('scheduler', ['scheduler:start'])).toBe(false)
    // a different role's "done" is not this role's
    expect(shouldOpenTutorial('scheduler', ['editor:start'])).toBe(true)
    expect(shouldOpenTutorial('client', [])).toBe(false)
    expect(shouldOpenTutorial(null, [])).toBe(false)
  })

  it('every other role finds theirs in the sidebar, never by being sent there (the owner: "only for scheduler")', () => {
    for (const r of ['editor', 'general', 'account_manager', 'super_admin'] as Role[]) {
      expect(tutorialFor(r)).not.toBeNull()
      expect(shouldOpenTutorial(r, [])).toBe(false)
    }
  })

  it('clamps the step to the tutorial', () => {
    expect(clampStep(-1, 5)).toBe(0)
    expect(clampStep(99, 5)).toBe(4)
    expect(clampStep(2.7, 5)).toBe(2)
    expect(clampStep(NaN, 5)).toBe(0)
    expect(clampStep(3, 0)).toBe(0)
  })
})

describe('every step is a real step', () => {
  it('has something to look at, something to do, and a page that exists', () => {
    const hrefs = new Set([...NAV_MAIN, ...NAV_SOCIAL_CHILDREN, ...NAV_TOOLS].map(i => i.href))
    for (const r of ROLES) {
      const t = tutorialFor(r)!
      expect(t.steps.length).toBeGreaterThanOrEqual(4)
      expect(hrefs.has(t.home)).toBe(true)
      for (const s of t.steps) {
        expect(s.see.length, `${r}: ${s.title} says what you are looking at`).toBeGreaterThan(0)
        expect(s.actions.length, `${r}: ${s.title} says what to do`).toBeGreaterThan(0)
        if (s.href) expect(hrefs.has(s.href), `${r}: ${s.title} links to ${s.href}`).toBe(true)
      }
    }
  })
})

describe('the words are the screen’s words', () => {
  const titles = Object.values(PAGE_TITLES)

  it('names the pages as the sidebar names them', () => {
    for (const r of ROLES) {
      const text = everyLine(r)
      for (const name of ['Post approval', 'Schedule', 'Shoots', 'Editor', 'Notifications']) {
        if (text.includes(name)) expect(titles, `${name} is a page title`).toContain(name)
      }
      // the old name must not come back through the tutorial
      expect(text).not.toMatch(/\bProduction page\b|\bOpen Production\b/)
    }
  })

  it('names the board columns as the board draws them', () => {
    const labels = BOARD_COLUMNS.map(c => c.label)
    for (const l of ['Draft', 'Internal check', 'With client', 'Ready to post', 'Posted']) expect(labels).toContain(l)
    expect(everyLine('scheduler')).toContain('Draft, Internal check, With client, Ready to post, Posted')
  })

  it('quotes the composer’s buttons as they read', () => {
    expect(SEND_FOR_REVIEW).toBe('Send for approval')
    const composeCore = read('app/lib/schedule-compose-core.ts')
    expect(composeCore).toContain("label: 'Schedule'")
    expect(composeCore).toContain("'Post now'")
    const scheduler = everyLine('scheduler')
    expect(scheduler).toContain('Send for approval')
    expect(scheduler).toContain('Post now')
  })

  it('quotes the New post window’s sources and its button', () => {
    const uploadCore = read('app/lib/schedule-upload-core.ts')
    for (const label of ['Approved media', 'Upload', 'Google Drive']) expect(uploadCore).toContain(`label: '${label}'`)
    const page = read('app/dashboard/social/schedule/page.tsx') + read('app/dashboard/social/schedule/NewPostSources.tsx')
    expect(page).toContain('New post')
    expect(read('app/dashboard/social/schedule/ProfilesBar.tsx')).toContain('Pick a client')
    for (const r of ['scheduler', 'account_manager'] as Role[]) {
      const text = everyLine(r)
      expect(text).toContain('New post')
      expect(text).toContain('Approved media')
    }
  })

  it('tells a scheduler the truth about approval, and a manager the truth about the lock', () => {
    const s = everyLine('scheduler')
    expect(s).toContain('You do not approve posts')
    const m = everyLine('account_manager')
    expect(m).toContain('It does not stop you')
    expect(m).not.toContain('Nobody here can skip')
  })
})
