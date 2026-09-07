import type { Role } from './identity-core'

/**
 * The three things a new hire needs on their first day, per role — and now
 * per PAGE, because the first day happens on four different screens.
 *
 * Until now the app explained itself nowhere: no tour, no first-run panel, no
 * `?`, no glossary. Every invented word had to be learned by asking a
 * colleague. This is the smallest honest fix — three steps, each a real link,
 * on the page the person is standing on.
 *
 * Pure data so the copy can be tested and swept for jargon. The panel that
 * renders it is app/dashboard/GettingStarted.tsx.
 */

export type GettingStartedStep = {
  /** the imperative — what they do */
  title: string
  /** one sentence of why/how, in plain words */
  body: string
  /** the link that actually does it. Never "go and find it". Optional: a
   *  purely explanatory step (one that would only point at the page it is
   *  already on) omits it, so three explanatory steps do not read as three
   *  competing buttons. */
  href?: string
  linkLabel?: string
}

export type GettingStartedPanel = {
  heading: string
  steps: [GettingStartedStep, GettingStartedStep, GettingStartedStep]
}

/** The screens that carry a panel. 'overview' is the landing page. */
export type GettingStartedPage = 'overview' | 'editor' | 'scheduler' | 'production' | 'item'

const HEADING = 'New here? Three things to know.'

const EDITOR: GettingStartedPanel = {
  heading: HEADING,
  steps: [
    {
      title: 'Find your work',
      body: 'Every card assigned to you is on your board: Draft, Internal check and With client, with what is done folded into one narrow lane at the end. One card is one thing to make: it shows what needs doing and the link to the work.',
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
    {
      title: 'Add the link, then hand it on',
      body: 'Paste the Google Drive or Dropbox link on the card, then press "Ready for checking". An account manager checks it next.',
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
    {
      title: 'Watch for changes',
      body: 'A card that comes back shows what to change, in the account manager’s words, right on the card.',
      href: '/dashboard/notifications',
      linkLabel: 'See what came back',
    },
  ],
}

const SCHEDULER: GettingStartedPanel = {
  heading: HEADING,
  steps: [
    {
      title: 'See what is coming',
      body: 'Every card for your clients is on the board: Ready to post and Posted have the room, and what is still being made is folded into "Coming up" on the left. Only Ready to post has been signed off — nothing else is yours to post yet.',
      href: '/dashboard/scheduler',
      linkLabel: 'See the board',
    },
    {
      title: 'Take the link, post it, move the card',
      body: 'Each card shows what needs doing and the link to the work. Post it on the Schedule page, then press "Booked in" on the card — and "Posted" once it is live.',
      href: '/dashboard/social/schedule',
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Booked in is not posted',
      body: 'Booked in means it has a time. Posted means it is actually live. The posting calendar shows both.',
      href: '/dashboard/scheduler/calendar',
      linkLabel: 'Open the posting calendar',
    },
  ],
}

const ACCOUNT_MANAGER: GettingStartedPanel = {
  heading: HEADING,
  steps: [
    {
      title: 'Your clients',
      body: 'Each client has a monthly agreement. The Overview table shows what is still owed this month.',
      href: '/dashboard/clients',
      linkLabel: 'See my clients',
    },
    {
      title: 'Check, then send on',
      body: 'Cards in "Internal check" are waiting on you. Send them to the client, or send them back with what needs changing.',
      href: '/dashboard/editor',
      linkLabel: 'Review what is waiting',
    },
    {
      title: 'Plan the next shoot',
      body: 'In Production, plan a shoot, write the shoot plan, share it with the client, then book the shoot.',
      href: '/dashboard/production',
      linkLabel: 'Go to Production',
    },
  ],
}

/** The Editor board as a MANAGER sees it: their job here is the review column. */
const EDITOR_PAGE_FOR_MANAGERS: GettingStartedPanel = {
  heading: 'The Editor board, for reviewers',
  steps: [
    {
      title: 'Your column is "Internal check"',
      body: 'Anything there is waiting on you. Open the link, check the work, then send it to the client — or send it back with what needs changing, right on the card.',
      href: '/dashboard/editor',
      linkLabel: 'See what is waiting',
    },
    {
      title: 'Nobody on it? Give it to someone',
      body: 'A card with nobody on it says "Nobody yet". Open it to hand it to a named editor, who is emailed the job.',
      href: '/dashboard/editor',
      linkLabel: 'Find unassigned cards',
    },
    {
      title: 'Signed off means "ready to post"',
      body: 'Once the client has signed off, the card moves to Ready to post and off this board for you. The Scheduler page shows it from there until it is live.',
      href: '/dashboard/scheduler',
      linkLabel: 'Open the Scheduler',
    },
  ],
}

const PRODUCTION_FOR_MANAGERS: GettingStartedPanel = {
  heading: 'Production, in three steps',
  steps: [
    {
      title: 'Make a shoot plan',
      body: 'Press New card ▾ → New shoot plan. The plan is the concept and shot list for one filming day — making it sets up the shoot too. You never create the shoot separately.',
    },
    {
      title: 'Get it signed off',
      body: 'Send the plan for review, then share it with the client. Cards move left to right across the board as they get approved.',
    },
    {
      title: 'Book the date, then add the pieces',
      body: 'Open the plan to book the filming date. After the shoot, add the reels and carousels — they land on the Editor board.',
    },
  ],
}

const PRODUCTION_FOR_EDITORS: GettingStartedPanel = {
  heading: 'Production, in three steps',
  steps: [
    {
      title: 'A card is one thing to make',
      body: 'One reel, one graphic, one piece of research — with one link to where it lives. Four reels is four cards. Cards move left to right across the five columns as they get checked.',
      href: '/dashboard/production',
      linkLabel: 'See the board',
    },
    {
      title: 'Shoots are their own cards',
      body: 'A shoot card is one filming day: the date, the location, the shot list and the folder. The cards made from it appear on your Editor board once it is booked.',
      href: '/dashboard/production',
      linkLabel: 'See the shoots',
    },
    {
      title: 'Make a card with New card',
      body: 'Press New card ▾, type what it is, and paste the link when the work is ready. A card with nobody on it says "Nobody yet" — open it to make it yours.',
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
  ],
}

const ITEM_PAGE: GettingStartedPanel = {
  heading: 'How this page works',
  steps: [
    {
      title: 'The top card says what to do now',
      body: 'It names whose move it is and shows one blue button for it. If the button is greyed out, the line under it says what is missing.',
      href: '#next',
      linkLabel: 'Jump to it',
    },
    {
      title: 'Add the link on the card',
      body: 'Paste the Google Drive or Dropbox link where the work lives, then save. Replacing it makes a new version; the latest one is what gets checked.',
      href: '#work',
      linkLabel: 'Jump to the link',
    },
    {
      title: 'Tag someone to ask a question',
      body: 'In Comments, type @ and a name. They get an email and a "Waiting on you" card until they mark it done.',
      href: '#comments',
      linkLabel: 'Jump to Comments',
    },
  ],
}

/**
 * Which panel a role sees on the Overview. Super admins get the account-
 * manager one — they do that job too, and inventing a fourth panel for one
 * person is copy that never gets maintained. Clients get nothing: this is
 * staff onboarding.
 */
export function panelForRole(role: Role | null): GettingStartedPanel | null {
  switch (role) {
    case 'editor': return EDITOR
    case 'scheduler': return SCHEDULER
    case 'account_manager':
    case 'super_admin': return ACCOUNT_MANAGER
    default: return null
  }
}

/** Which panel a role sees on a given PAGE. The Overview keeps the role
 *  panel; the work pages explain themselves in that role's words. */
export function panelForPage(page: GettingStartedPage, role: Role | null): GettingStartedPanel | null {
  if (role === null || role === 'client') return null
  const manager = role === 'account_manager' || role === 'super_admin'
  switch (page) {
    case 'overview': return panelForRole(role)
    case 'editor': return manager ? EDITOR_PAGE_FOR_MANAGERS : role === 'editor' ? EDITOR : null
    case 'scheduler': return role === 'scheduler' || manager ? SCHEDULER : null
    case 'production': return manager ? PRODUCTION_FOR_MANAGERS : PRODUCTION_FOR_EDITORS
    case 'item': return ITEM_PAGE
    default: return null
  }
}

/** The key a dismissal is stored under — per role AND per page, so a
 *  promotion re-earns each page's three steps once. */
export function dismissKey(page: GettingStartedPage, role: Role): string {
  return page === 'overview' ? role : `${role}:${page}`
}

/**
 * Show the panel unless this exact role has already been dismissed. A promotion
 * changes the job, so it re-earns three steps.
 */
export function shouldShowGettingStarted(
  role: Role | null,
  dismissedRole: string | null | undefined,
): boolean {
  if (panelForRole(role) === null) return false
  return dismissedRole !== role
}

/** The per-page rule: shown unless this page was dismissed in this role. */
export function shouldShowPagePanel(
  page: GettingStartedPage,
  role: Role | null,
  dismissedRole: string | null | undefined,
  dismissedPages: readonly string[] | null | undefined,
): boolean {
  if (role === null || panelForPage(page, role) === null) return false
  if (page === 'overview') return shouldShowGettingStarted(role, dismissedRole)
  return !(dismissedPages ?? []).includes(dismissKey(page, role))
}
