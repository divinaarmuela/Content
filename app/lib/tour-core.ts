import type { Role } from './identity-core'

/**
 * THE FIRST-SIGN-IN WALKTHROUGH for the Schedule page and the post window.
 *
 * Two short spotlight tours, each one sentence a step, each remembered per
 * person so it runs once and then gets out of the way. The words live here,
 * away from the markup, so they can be read as a whole and swept for jargon:
 * a tour that explains the product in the product's own invented words
 * teaches nobody anything.
 *
 * Nothing in this file touches the DOM, the network or storage. The component
 * that draws the spotlight is app/dashboard/social/schedule/Tour.tsx; it asks
 * this file what the steps are, which one is next, and whether to run at all.
 *
 * A step names its target by `data-tour="<target>"`. A target that is not on
 * the screen (no channels connected yet, a button that only exists on a
 * desktop) is not an error: `nextStep` walks past it. That is why the steps
 * are a plain list and the walking is a pure function — the awkward part is
 * the part worth testing.
 */

export type TourId = 'schedule' | 'post-window'

export type TourStep = {
  /** the value of the `data-tour` attribute on the element to point at */
  target: string
  /** three or four words, in the person's language */
  title: string
  /** ONE sentence. Two is a paragraph, and a paragraph does not get read. */
  body: string
}

export type Tour = {
  id: TourId
  /** the sentence at the top of the card, before the steps start */
  name: string
  steps: TourStep[]
}

/** Tour 1: the Schedule page itself, in the order the eye crosses it. */
export const SCHEDULE_TOUR: Tour = {
  id: 'schedule',
  name: 'The Schedule page',
  steps: [
    {
      target: 'media-rail',
      title: 'Approved files live here',
      body: 'This is where approved files wait: tick the ones you want and press Post, or drag a folder onto a time. At the bottom, "Waiting for approval" is what a reviewer still has and "Drafts" is what you saved and left.',
    },
    {
      target: 'profiles-bar',
      title: 'The client and their channels',
      body: 'These are the channels this client posts to, and a red one needs reconnecting before anything can go out on it.',
    },
    {
      target: 'week-grid',
      title: 'The week',
      body: 'Drag a post to move it to another time, click an empty time to start one there, and press "Night hours" to show midnight to 5 am.',
    },
    {
      target: 'views',
      title: 'Four ways to look at it',
      body: 'Week, Month, List, Preview and Stories show the same posts different ways, and drafts only appear in the List.',
    },
    {
      target: 'nav-posts',
      title: 'What actually went out',
      body: 'The Posts page in the sidebar shows what went out and what did not, channel by channel.',
    },
  ],
}

/** Tour 2: the post window, in the order the post gets built. */
export const POST_WINDOW_TOUR: Tour = {
  id: 'post-window',
  name: 'The post window',
  steps: [
    {
      target: 'post-channels',
      title: 'Where it goes',
      body: 'Pick the channels this post goes to; you can tick more than one and they all get the same post.',
    },
    {
      target: 'post-kind',
      title: 'What kind of post',
      body: 'Leave it on Auto publish and each network decides for itself, or choose Reel, Story, Carousel or Trial Reel.',
    },
    {
      target: 'post-cover',
      title: 'The cover',
      body: 'For a video, choose the frame people see before they press play, or upload a picture of your own.',
    },
    {
      target: 'post-options',
      title: 'More options',
      body: 'Each network has its own settings here, and only the ones that network really has are shown.',
    },
    {
      target: 'post-check',
      title: 'Before you schedule',
      body: 'This says what each channel will do with your files while you can still swap them, and Preview shows the post the way each network will.',
    },
    {
      target: 'post-time',
      title: 'The time',
      body: 'Set the time here or press one of the best times, and if clean copies of your video are still being made the clock starts at the earliest safe time.',
    },
    {
      target: 'post-submit',
      title: 'The last press',
      body: 'This button says exactly what it will do, whether that is Send for approval, Schedule or Post now, and a booked post can still be moved later by dragging it on the calendar.',
    },
  ],
}

export const TOURS: Record<TourId, Tour> = {
  schedule: SCHEDULE_TOUR,
  'post-window': POST_WINDOW_TOUR,
}

/** The localStorage prefix. Exported so "Show me again" can clear every tour
 *  for every account signed in on this browser without knowing any user id. */
export const TOUR_SEEN_PREFIX = 'md-tour-seen:'

/**
 * Where "this person has seen this tour" is remembered.
 *
 * Keyed on the USER, not the browser: two people sharing a laptop each get
 * their own first run. A second browser is a second first run, and that is a
 * cheerful loss — the alternative is a database write on a page whose whole
 * point is that it opens fast.
 */
export function tourKey(userId: string, tourId: TourId): string {
  return `${TOUR_SEEN_PREFIX}${userId}:${tourId}`
}

/** The roles that plan and book posts. An editor never opens this page to
 *  post, and a client never sees it at all. */
export const TOUR_ROLES: readonly Role[] = ['scheduler', 'general', 'account_manager', 'super_admin']

/** Run the tour for a posting role that has not seen it. Unknown role (the
 *  answer has not arrived yet) means no: a tour that starts before the page
 *  has drawn points at nothing. */
export function shouldRunTour(role: Role | null | undefined, seen: boolean): boolean {
  if (seen || !role) return false
  return (TOUR_ROLES as readonly string[]).includes(role)
}

/**
 * The next step in `direction` whose target is actually on the screen.
 *
 * `null` means the tour is over that way: forward past the last present step
 * finishes it, backward past the first one leaves Back with nothing to do.
 * `present` is asked per step rather than given as a list because the page
 * changes underneath the tour — a channel connects, the view switches — and
 * the answer has to be the one true at the moment of the press.
 */
export function nextStep(
  steps: readonly TourStep[],
  from: number,
  direction: 1 | -1,
  present: (target: string) => boolean,
): number | null {
  for (let i = from + direction; i >= 0 && i < steps.length; i += direction) {
    if (present(steps[i].target)) return i
  }
  return null
}

/** Where a tour starts: its first step that is on the screen, or null when
 *  none of them are and the tour should not open at all. */
export function firstStep(
  steps: readonly TourStep[],
  present: (target: string) => boolean,
): number | null {
  return nextStep(steps, -1, 1, present)
}

/** "Step 2 of 5", counting only the steps this person will actually be shown. */
export function stepCount(
  steps: readonly TourStep[],
  present: (target: string) => boolean,
): number {
  return steps.filter(s => present(s.target)).length
}

/** Which of those they are on, 1-based. */
export function stepNumber(
  steps: readonly TourStep[],
  index: number,
  present: (target: string) => boolean,
): number {
  return steps.slice(0, index + 1).filter(s => present(s.target)).length
}

/**
 * Which stored keys "Show me again" throws away.
 *
 * Every tour, for every account signed in on this browser: the panel that
 * offers it does not know a user id, and somebody pressing "Show me again"
 * wants the tour, not a lecture about whose browser this is.
 */
export function tourKeysToClear(keys: readonly string[]): string[] {
  return keys.filter(k => k.startsWith(TOUR_SEEN_PREFIX))
}
