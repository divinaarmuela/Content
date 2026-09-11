import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTO_OPEN_ROLES, clampStep, EDITOR_COLUMNS, POST_APPROVAL_COLUMNS, QUALITY_REVIEWER_STEP, SHOOT_COLUMNS,
  shouldOpenTutorial, tutorialFor, tutorialKey,
} from '../app/lib/tutorial-core'
import { SHOOT_STAGES } from '../app/lib/shoot-sop-core'
import { panelForPage, type GettingStartedPage } from '../app/lib/getting-started-core'
import { TOURS } from '../app/lib/tour-core'
import { NAV_MAIN, NAV_SOCIAL_CHILDREN, NAV_TOOLS, PAGE_TITLES } from '../app/dashboard/ui/Shell'
import { BOARD_COLUMNS } from '../app/lib/board-core'
import { SEND_FOR_REVIEW } from '../app/lib/schedule-compose-core'
import type { Role } from '../app/lib/identity-core'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(p.startsWith(root) ? p : join(root, p), 'utf8')
const allTsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? allTsx(join(dir, d.name)) : d.name.endsWith('.tsx') ? [join(dir, d.name)] : [])

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

  it('opens once for every team role on their first sign-in (the owner, 11 Sep 2026), and stays in the sidebar after', () => {
    for (const r of ROLES) {
      expect(AUTO_OPEN_ROLES).toContain(r)
      expect(shouldOpenTutorial(r, [])).toBe(true)
      expect(shouldOpenTutorial(r, [tutorialKey(r)])).toBe(false)
    }
  })

  it('lands each role on their own first page', () => {
    expect(tutorialFor('scheduler')!.home).toBe('/dashboard/scheduler')
    expect(tutorialFor('editor')!.home).toBe('/dashboard/editor')
    expect(tutorialFor('general')!.home).toBe('/dashboard/editor')
    expect(tutorialFor('account_manager')!.home).toBe('/dashboard')
  })

  it('a flagged quality reviewer gets their role\u2019s tutorial plus the quality step, before Where answers arrive', () => {
    for (const r of ROLES) {
      const plain = tutorialFor(r)!
      const joy = tutorialFor(r, { qualityReviewer: true })!
      expect(joy.steps.length).toBe(plain.steps.length + 1)
      expect(joy.steps[joy.steps.length - 2]).toBe(QUALITY_REVIEWER_STEP)
      expect(joy.steps[joy.steps.length - 1].title).toBe('Where answers arrive')
      expect(tutorialFor(r, { qualityReviewer: false })).toBe(plain)
    }
    const words = [...QUALITY_REVIEWER_STEP.see, ...QUALITY_REVIEWER_STEP.actions].join('\n')
    expect(words).toContain('Passed \u2014 send to client')
    expect(words).toContain('Ask for changes')
    expect(words).not.toContain('Send for quality check')
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
    // the seven the playbook flow runs through, in order; a "Delivered"
    // column for clients who post their own may sit after them
    expect(labels.join(', ')).toContain(POST_APPROVAL_COLUMNS)
    expect(everyLine('scheduler')).toContain(POST_APPROVAL_COLUMNS)
    expect(everyLine('account_manager')).toContain(POST_APPROVAL_COLUMNS)
    // the shoot stages, in the SOP's order
    expect(SHOOT_COLUMNS).toBe(SHOOT_STAGES.map(s => s.label).join(', '))
    expect(everyLine('account_manager')).toContain(SHOOT_COLUMNS)
    expect(everyLine('editor')).toContain(SHOOT_COLUMNS)
    // the Editor lanes, as the Editor page names them
    const editorPage = read('app/lib/board-view-core.ts') + read('app/lib/board-core.ts')
    for (const lane of EDITOR_COLUMNS.split(', ')) expect(editorPage, lane).toContain(`'${lane}'`)
  })

  it('tells every role the quality check sits between the manager and the client, and never tells the wrong person to press it', () => {
    for (const r of ROLES) expect(everyLine(r).toLowerCase()).toContain('quality')
    for (const r of ['scheduler', 'editor', 'general'] as Role[]) {
      const actions = tutorialFor(r)!.steps.flatMap(s => s.actions).join('\n')
      expect(actions, r).not.toContain('Send for quality check')
      expect(actions, r).not.toContain('Hand to')
      expect(actions, r).not.toMatch(/press "?Approve/i)
    }
    expect(tutorialFor('account_manager')!.steps.flatMap(s => s.actions).join('\n')).toContain('Send for quality check')
  })

  it('names no page or button that is gone', () => {
    for (const r of ROLES) {
      const text = everyLine(r)
      for (const gone of ['Shoot brief boards', 'Scheduler page', 'Coming up', 'Five columns', 'Send back to myself', 'paste the link', 'Plan link']) {
        expect(text, `${r}: ${gone}`).not.toContain(gone)
      }
    }
  })

  it('every Getting started link is a page in the sidebar or an anchor on the page', () => {
    const hrefs = new Set([...NAV_MAIN, ...NAV_SOCIAL_CHILDREN, ...NAV_TOOLS].map(i => i.href))
    const pages: GettingStartedPage[] = ['overview', 'editor', 'scheduler', 'production', 'item']
    for (const page of pages) for (const r of ROLES) {
      const panel = panelForPage(page, r)
      if (!panel) continue
      for (const s of panel.steps) {
        if (s.href && !s.href.startsWith('#')) expect(hrefs.has(s.href), `${page}/${r}: ${s.href}`).toBe(true)
      }
    }
  })

  it('every tour target is drawn somewhere in the app', () => {
    const src = ['app/dashboard', 'app/components'].flatMap(dir => allTsx(join(root, dir))).map(read).join('\n')
    for (const tour of Object.values(TOURS)) {
      for (const step of tour.steps) {
        const drawn = src.includes(`data-tour="${step.target}"`) || src.includes(`'${step.target}'`) || src.includes(`tour="${step.target}"`)
        expect(drawn, `${tour.id}: ${step.target}`).toBe(true)
      }
    }
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

  it('tells a scheduler the truth about approval, and a manager the truth about the gate', () => {
    const s = everyLine('scheduler')
    expect(s).toContain('You do not approve posts')
    const m = everyLine('account_manager')
    expect(m).toContain('You cannot send it to the client yourself')
    expect(m).toContain('sends it for quality check and says so in green')
  })
})
