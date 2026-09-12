import { describe, expect, it } from 'vitest'
import {
  firstStep, nextStep, POST_APPROVAL_TOUR, POST_WINDOW_TOUR, SCHEDULE_TOUR, shouldRunTour,
  stepBody, stepCount, stepIsForRole, stepNumber,
  TOURS, TOUR_SEEN_PREFIX, tourKey, tourKeysToClear, type TourStep,
} from '@/app/lib/tour-core'

const all = () => true
const none = () => false

describe('the tours themselves', () => {
  it('covers the five things on the Schedule page, in the order the eye crosses it', () => {
    expect(SCHEDULE_TOUR.steps.map(s => s.target)).toEqual([
      'media-rail', 'profiles-bar', 'week-grid', 'views', 'nav-posts',
    ])
  })

  it('covers the seven things in the post window', () => {
    expect(POST_WINDOW_TOUR.steps.map(s => s.target)).toEqual([
      'post-channels', 'post-kind', 'post-cover', 'post-options', 'post-check',
      'post-time', 'post-submit',
    ])
  })

  it('covers the Post approval board, from the columns to the drawer', () => {
    expect(POST_APPROVAL_TOUR.steps.map(s => s.target)).toEqual([
      'board-lanes', 'board-new-post', 'board-card', 'board-card-action',
      'post-drawer', 'post-by-hand', 'hand-to',
    ])
  })

  it('names the five columns and says what each one means', () => {
    const columns = POST_APPROVAL_TOUR.steps.find(s => s.target === 'board-lanes')!.body
    for (const label of ['Draft', 'Quality check', 'With client', 'Ready to post', 'Posted']) {
      expect(columns, label).toContain(label)
    }
  })

  it('is registered under its own id', () => {
    expect(TOURS.schedule).toBe(SCHEDULE_TOUR)
    expect(TOURS['post-window']).toBe(POST_WINDOW_TOUR)
    expect(TOURS['post-approval']).toBe(POST_APPROVAL_TOUR)
  })

  const steps: TourStep[] = [...SCHEDULE_TOUR.steps, ...POST_WINDOW_TOUR.steps, ...POST_APPROVAL_TOUR.steps]

  it('says one short thing per step, with no em dashes and no jargon', () => {
    for (const s of steps) {
      expect(s.title.length, s.title).toBeLessThanOrEqual(40)
      expect(s.body.length, s.title).toBeLessThanOrEqual(240)
      for (const [role, body] of Object.entries(s.bodyByRole ?? {})) {
        expect(body.length, `${s.title} (${role})`).toBeLessThanOrEqual(240)
        expect(body, `${s.title} (${role})`).not.toMatch(/[—–]/)
        expect(body.trim().endsWith('.'), `${s.title} (${role})`).toBe(true)
      }
      expect(s.body, s.title).not.toMatch(/[—–]/)
      expect(s.title, s.title).not.toMatch(/[—–]/)
      expect(s.body, s.title).not.toMatch(/\b(asset|CTA|SKU|onboarding|leverage|utilise)\b/i)
      expect(s.body.trim().endsWith('.'), s.title).toBe(true)
    }
  })

  it('names every target exactly once', () => {
    const targets = steps.map(s => s.target)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('tells the scheduler the two rules that cost real posts', () => {
    const list = SCHEDULE_TOUR.steps.find(s => s.target === 'views')!
    expect(list.body).toMatch(/drafts only appear in the List/i)
    const time = POST_WINDOW_TOUR.steps.find(s => s.target === 'post-time')!
    expect(time.body).toMatch(/earliest safe time/i)
  })
})

describe("a step that is only some people's", () => {
  const columns = POST_APPROVAL_TOUR.steps.find(s => s.target === 'board-lanes')!
  const handTo = POST_APPROVAL_TOUR.steps.find(s => s.target === 'hand-to')!
  const newPost = POST_APPROVAL_TOUR.steps.find(s => s.target === 'board-new-post')!

  it("is everybody's when it names no roles", () => {
    expect(stepIsForRole(columns, 'scheduler')).toBe(true)
    expect(stepIsForRole(columns, 'super_admin')).toBe(true)
    expect(stepIsForRole(columns, null)).toBe(true)
  })

  it("is only the named roles' when it names some", () => {
    expect(stepIsForRole(handTo, 'account_manager')).toBe(true)
    expect(stepIsForRole(handTo, 'super_admin')).toBe(true)
    expect(stepIsForRole(handTo, 'scheduler')).toBe(false)
    expect(stepIsForRole(handTo, 'general')).toBe(false)
    // the role has not arrived yet: better a step short than a wrong one
    expect(stepIsForRole(handTo, null)).toBe(false)
  })

  it('says a manager a different sentence, and everybody else the plain one', () => {
    expect(stepBody(newPost, 'scheduler')).toBe(newPost.body)
    expect(stepBody(newPost, 'general')).toBe(newPost.body)
    expect(stepBody(newPost, null)).toBe(newPost.body)
    // the manager sends uploads for the quality check; the super admin may still clear them (11 Sep 2026)
    expect(stepBody(newPost, 'account_manager')).toMatch(/quality check/i)
    expect(stepBody(newPost, 'super_admin')).toMatch(/approve them yourself/i)
  })

  it('tells a scheduler to send the files on, and a manager what they may answer', () => {
    const buttons = POST_APPROVAL_TOUR.steps.find(s => s.target === 'board-card-action')!
    expect(stepBody(buttons, 'scheduler')).toMatch(/one button/i)
    expect(stepBody(buttons, 'account_manager')).toMatch(/nothing the channel already holds can be deleted/i)
  })
})

describe('walking a tour as one role', () => {
  const steps = POST_APPROVAL_TOUR.steps
  const all = () => true

  it("walks a scheduler past the manager's step, forwards and back", () => {
    const handTo = steps.findIndex(s => s.target === 'hand-to')
    const byHand = steps.findIndex(s => s.target === 'post-by-hand')
    expect(nextStep(steps, byHand, 1, all, 'scheduler')).toBeNull()
    expect(nextStep(steps, byHand, 1, all, 'super_admin')).toBe(handTo)
    expect(nextStep(steps, handTo, -1, all, 'super_admin')).toBe(byHand)
  })

  it('counts and numbers only the steps that role really sees', () => {
    expect(stepCount(steps, all, 'super_admin')).toBe(steps.length)
    expect(stepCount(steps, all, 'scheduler')).toBe(steps.length - 1)
    const last = steps.length - 1
    expect(stepNumber(steps, last, all, 'super_admin')).toBe(steps.length)
    // the scheduler's last step is the one before the manager's
    expect(stepNumber(steps, last - 1, all, 'scheduler')).toBe(steps.length - 1)
  })

  it('skips a missing target and a wrong role the same way', () => {
    // an empty board with nothing open: only the columns and the upload
    const present = (t: string) => t === 'board-lanes' || t === 'board-new-post'
    expect(firstStep(steps, present, 'scheduler')).toBe(0)
    expect(stepCount(steps, present, 'scheduler')).toBe(2)
    expect(nextStep(steps, 0, 1, present, 'scheduler')).toBe(1)
    expect(nextStep(steps, 1, 1, present, 'scheduler')).toBeNull()
  })

  it('opens for a manager on a board where only their own step is drawn', () => {
    expect(firstStep(steps, t => t === 'hand-to', 'super_admin')).toBe(steps.length - 1)
    expect(firstStep(steps, t => t === 'hand-to', 'scheduler')).toBeNull()
  })
})

describe('tourKey', () => {
  it('is per person and per tour', () => {
    expect(tourKey('u1', 'schedule')).toBe(`${TOUR_SEEN_PREFIX}u1:schedule`)
    expect(tourKey('u1', 'post-window')).not.toBe(tourKey('u1', 'schedule'))
    expect(tourKey('u2', 'schedule')).not.toBe(tourKey('u1', 'schedule'))
  })
})

describe('shouldRunTour', () => {
  it('runs for everybody who plans or books posts', () => {
    for (const role of ['scheduler', 'general', 'account_manager', 'super_admin'] as const) {
      expect(shouldRunTour(role, false), role).toBe(true)
    }
  })

  it('does not run for an editor or a client', () => {
    expect(shouldRunTour('editor', false)).toBe(false)
    expect(shouldRunTour('client', false)).toBe(false)
  })

  it('does not run before the role is known', () => {
    expect(shouldRunTour(null, false)).toBe(false)
    expect(shouldRunTour(undefined, false)).toBe(false)
  })

  it('runs once: seen is the end of it', () => {
    expect(shouldRunTour('scheduler', true)).toBe(false)
    expect(shouldRunTour('super_admin', true)).toBe(false)
  })
})

describe('nextStep', () => {
  const steps = SCHEDULE_TOUR.steps

  it('walks forward and stops at the end', () => {
    expect(nextStep(steps, 0, 1, all)).toBe(1)
    expect(nextStep(steps, steps.length - 1, 1, all)).toBeNull()
  })

  it('walks back and stops at the start', () => {
    expect(nextStep(steps, 2, -1, all)).toBe(1)
    expect(nextStep(steps, 0, -1, all)).toBeNull()
  })

  it('steps over a target that is not on the screen', () => {
    // no channels connected yet: the profiles bar step has nothing to point at
    const present = (t: string) => t !== 'profiles-bar'
    expect(nextStep(steps, 0, 1, present)).toBe(2)
    expect(nextStep(steps, 2, -1, present)).toBe(0)
  })

  it('finishes rather than pointing at nothing when the rest is missing', () => {
    const present = (t: string) => t === 'media-rail'
    expect(nextStep(steps, 0, 1, present)).toBeNull()
  })
})

describe('firstStep', () => {
  it('is the first step that is actually there', () => {
    expect(firstStep(SCHEDULE_TOUR.steps, all)).toBe(0)
    expect(firstStep(SCHEDULE_TOUR.steps, t => t === 'week-grid')).toBe(2)
  })

  it('is null when the page has none of them, so the tour never opens', () => {
    expect(firstStep(SCHEDULE_TOUR.steps, none)).toBeNull()
  })
})

describe('counting the steps a person will really see', () => {
  it('counts only what is on the screen', () => {
    expect(stepCount(SCHEDULE_TOUR.steps, all)).toBe(5)
    expect(stepCount(SCHEDULE_TOUR.steps, t => t !== 'nav-posts')).toBe(4)
  })

  it('numbers the current one the same way', () => {
    expect(stepNumber(SCHEDULE_TOUR.steps, 0, all)).toBe(1)
    expect(stepNumber(SCHEDULE_TOUR.steps, 4, all)).toBe(5)
    // the profiles bar is missing, so the week grid is step 2 of 4
    const present = (t: string) => t !== 'profiles-bar'
    expect(stepNumber(SCHEDULE_TOUR.steps, 2, present)).toBe(2)
    expect(stepCount(SCHEDULE_TOUR.steps, present)).toBe(4)
  })
})

describe('tourKeysToClear', () => {
  it('throws away every tour it finds, and nothing else', () => {
    const keys = [
      tourKey('u1', 'schedule'), tourKey('u2', 'post-window'),
      'md-schedule-view', 'md-getting-started-dismissed', 'md-schedule-starred',
    ]
    expect(tourKeysToClear(keys)).toEqual([tourKey('u1', 'schedule'), tourKey('u2', 'post-window')])
  })

  it('is happy with nothing stored', () => {
    expect(tourKeysToClear([])).toEqual([])
  })
})
