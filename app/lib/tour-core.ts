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

export type TourId = 'schedule' | 'post-window' | 'post-approval'

export type TourStep = {
  /** the value of the `data-tour` attribute on the element to point at */
  target: string
  /** three or four words, in the person's language */
  title: string
  /** ONE sentence. Two is a paragraph, and a paragraph does not get read. */
  body: string
  /**
   * Whose step this is. Left out, everybody on the tour sees it; given, only
   * these roles do and everybody else walks straight past it, exactly as
   * they walk past a target that is not on the screen. "Hand to" is a
   * manager's button, and a scheduler being told about a button they do not
   * have is a scheduler being taught to distrust the walkthrough.
   */
  roles?: readonly Role[]
  /**
   * The same step, said differently to different people. A scheduler uploads
   * files and sends them on; a manager uploads files and answers them. One
   * sentence each, and `body` is what anybody not named here reads.
   */
  bodyByRole?: Partial<Record<Role, string>>
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

/**
 * Tour 3: the Post approval board, in the order the work moves across it.
 *
 * The same board is drawn on the Post approval page, on Production and on
 * Editor, so the steps only ever name things the board itself owns; the
 * "New post" button belongs to the Post approval page alone and is simply
 * missing elsewhere, which is a target that is not on the screen and is
 * walked past like any other.
 *
 * Three steps live inside the card's own drawer. They are shown when the
 * drawer is open and skipped when it is not, which is why "Open a card"
 * comes first among them.
 */
export const POST_APPROVAL_TOUR: Tour = {
  id: 'post-approval',
  name: 'The Post approval board',
  steps: [
    {
      target: 'board-lanes',
      title: 'The columns',
      body: 'Draft is still being made, Internal check is with an account manager, Quality check is with the quality reviewer, With client is with them, Ready to post is signed off and needs a time, and Posted is booked in or already live.',
    },
    {
      target: 'board-new-post',
      title: 'Starting a post',
      body: 'Upload the files here, then send them to your account manager to check.',
      bodyByRole: {
        account_manager: 'Upload files here and send them for the quality check, or ask somebody to check them first. The quality reviewer sends them on to the client or the scheduler.',
        super_admin: 'Upload files here and approve them yourself, send them to the client, or ask somebody to check them. Everybody else’s uploads pass the quality reviewer first.',
      },
    },
    {
      target: 'board-card',
      title: 'One piece of work',
      body: 'The face of a card carries the title, the stage it is at, where and when it is booked, and how much of it has gone out so far.',
    },
    {
      target: 'board-card-action',
      title: 'The button and the dots',
      body: 'Your one button does the next thing; the dots hold the rest.',
      bodyByRole: {
        account_manager: 'Send it for quality check, ask for changes, hand it to a scheduler, or delete it, and nothing the channel already holds can be deleted. Only the quality reviewer passes it to the client.',
        super_admin: 'Pass it, ask for changes, hand it to a scheduler, or delete it, and nothing the channel already holds can be deleted. You can pass the quality check when the reviewer is away.',
      },
    },
    {
      target: 'post-drawer',
      title: 'The card, opened',
      body: 'Open a card for the files, what happened to it step by step, and what was said.',
    },
    {
      target: 'post-by-hand',
      title: 'Posted it yourself',
      // everybody on this tour posts; an editor never sees the board at all
      roles: ['scheduler', 'general', 'account_manager', 'super_admin'],
      body: 'If you posted a file yourself, mark it here with the link so the card and the client know.',
    },
    {
      target: 'hand-to',
      title: 'Handing it over',
      roles: ['account_manager', 'super_admin'],
      body: 'Hand a ready post to a scheduler; they book it on the Schedule page.',
    },
  ],
}

export const TOURS: Record<TourId, Tour> = {
  schedule: SCHEDULE_TOUR,
  'post-window': POST_WINDOW_TOUR,
  'post-approval': POST_APPROVAL_TOUR,
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
 * Is this step this person's at all?
 *
 * A step with no `roles` is everybody's. A step with `roles` belongs to
 * those roles only, and to nobody while the role is still unknown: better a
 * step short than a scheduler told about a manager's button.
 */
export function stepIsForRole(step: TourStep, role: Role | null | undefined): boolean {
  if (!step.roles) return true
  if (!role) return false
  return step.roles.includes(role)
}

/** The sentence this person reads: their own if the step wrote one for them,
 *  otherwise the plain one. */
export function stepBody(step: TourStep, role: Role | null | undefined): string {
  return (role && step.bodyByRole?.[role]) || step.body
}

/** A step is walked past for either reason, and they are the same reason as
 *  far as the walk is concerned: it is not this person's step. */
function shown(step: TourStep, role: Role | null | undefined, present: (target: string) => boolean): boolean {
  return stepIsForRole(step, role) && present(step.target)
}

/**
 * The next step in `direction` whose target is actually on the screen AND
 * belongs to this person.
 *
 * `null` means the tour is over that way: forward past the last present step
 * finishes it, backward past the first one leaves Back with nothing to do.
 * `present` is asked per step rather than given as a list because the page
 * changes underneath the tour — a channel connects, the view switches — and
 * the answer has to be the one true at the moment of the press. `role` is
 * optional so the two tours that are the same for everybody can ignore it.
 */
export function nextStep(
  steps: readonly TourStep[],
  from: number,
  direction: 1 | -1,
  present: (target: string) => boolean,
  role?: Role | null,
): number | null {
  for (let i = from + direction; i >= 0 && i < steps.length; i += direction) {
    if (shown(steps[i], role, present)) return i
  }
  return null
}

/** Where a tour starts: its first step that is on the screen and theirs, or
 *  null when none are and the tour should not open at all. */
export function firstStep(
  steps: readonly TourStep[],
  present: (target: string) => boolean,
  role?: Role | null,
): number | null {
  return nextStep(steps, -1, 1, present, role)
}

/** "Step 2 of 5", counting only the steps this person will actually be shown. */
export function stepCount(
  steps: readonly TourStep[],
  present: (target: string) => boolean,
  role?: Role | null,
): number {
  return steps.filter(s => shown(s, role, present)).length
}

/** Which of those they are on, 1-based. */
export function stepNumber(
  steps: readonly TourStep[],
  index: number,
  present: (target: string) => boolean,
  role?: Role | null,
): number {
  return steps.slice(0, index + 1).filter(s => shown(s, role, present)).length
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
