import { describe, expect, it } from 'vitest'
import {
  firstStep, nextStep, POST_WINDOW_TOUR, SCHEDULE_TOUR, shouldRunTour, stepCount, stepNumber,
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

  it('is registered under its own id', () => {
    expect(TOURS.schedule).toBe(SCHEDULE_TOUR)
    expect(TOURS['post-window']).toBe(POST_WINDOW_TOUR)
  })

  const steps: TourStep[] = [...SCHEDULE_TOUR.steps, ...POST_WINDOW_TOUR.steps]

  it('says one short thing per step, with no em dashes and no jargon', () => {
    for (const s of steps) {
      expect(s.title.length, s.title).toBeLessThanOrEqual(40)
      expect(s.body.length, s.title).toBeLessThanOrEqual(240)
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
