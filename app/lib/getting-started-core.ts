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
  /** the link that actually does it. Never "go and find it". */
  href: string
  linkLabel: string
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
      body: 'Your items sit in the Drafting column. Ones with no owner say anyone can take them — press "Take this" to make one yours.',
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
    {
      title: 'Attach it, then send it for review',
      body: 'Open an item, add the file or a link, then press Send for review. An account manager checks it next.',
      href: '/dashboard/editor',
      linkLabel: 'Open my first item',
    },
    {
      title: 'Watch for changes',
      body: 'If something comes back as "Being revised", the note explaining why is on that item’s page.',
      href: '/dashboard/notifications',
      linkLabel: 'See what came back',
    },
  ],
}

const SCHEDULER: GettingStartedPanel = {
  heading: HEADING,
  steps: [
    {
      title: 'Only signed-off work reaches you',
      body: 'Everything in this queue has already been approved by the client. Nothing here still needs their opinion.',
      href: '/dashboard/scheduler',
      linkLabel: 'See the queue',
    },
    {
      title: 'Take it, then set the date',
      body: 'Press "Take this", open the item, add a platform and a posting time. Times are in the audience’s timezone, not yours.',
      href: '/dashboard/scheduler',
      linkLabel: 'Open my first item',
    },
    {
      title: 'Scheduled is not published',
      body: 'Scheduled means a date is set. Published means it is actually live. The calendar shows both.',
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
      title: 'Review, then send on',
      body: 'Items in "Ready for review" are waiting on you. Approve them yourself, or send them to the client for sign-off.',
      href: '/dashboard/editor',
      linkLabel: 'Review what is waiting',
    },
    {
      title: 'Plan the next shoot',
      body: 'In Production, plan a shoot, write the shoot plan, share it with the client, then lock the date.',
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
      title: 'Your column is "Ready for review"',
      body: 'Anything there is waiting on you. Open it, watch the cut, then approve it or ask for changes with a note.',
      href: '/dashboard/editor',
      linkLabel: 'See what is waiting',
    },
    {
      title: 'Nobody on it? Give it to someone',
      body: 'Cards with no owner show "Take this" and "Assign…". Assign hands it to a named editor and emails them the brief.',
      href: '/dashboard/editor',
      linkLabel: 'Find unassigned items',
    },
    {
      title: 'Approved means "needs a posting date"',
      body: 'Once you approve, the item leaves this board for the Scheduler. Nothing is live until a scheduler sets a time.',
      href: '/dashboard/scheduler',
      linkLabel: 'Open the Scheduler',
    },
  ],
}

const PRODUCTION_FOR_MANAGERS: GettingStartedPanel = {
  heading: 'Production, in three steps',
  steps: [
    {
      title: 'Plan a shoot',
      body: 'A shoot is one filming day. Press New → Plan a shoot, pick the client, give it a working title.',
      href: '/dashboard/production',
      linkLabel: 'Plan a shoot',
    },
    {
      title: 'Write the shoot plan, get it signed off',
      body: 'The plan is what the client approves before we film. Write it on the shoot page, send it for review, then share it with the client.',
      href: '/dashboard/production',
      linkLabel: 'See shoot plans',
    },
    {
      title: 'Lock the date, then create the items',
      body: 'On the shoot page: lock the date, and after the shoot press Create items. Those items land on the Editor board.',
      href: '/dashboard/production',
      linkLabel: 'Open a shoot',
    },
  ],
}

const PRODUCTION_FOR_EDITORS: GettingStartedPanel = {
  heading: 'Production, in three steps',
  steps: [
    {
      title: 'Shoots are the filming days',
      body: 'Each card is one shoot. Open it for the date, the location, the shot list and the folder.',
      href: '/dashboard/production',
      linkLabel: 'See the shoots',
    },
    {
      title: 'Tasks are work with nothing to post',
      body: 'Research, strategy, copy. A task with no owner says "Take this" — press it and the task is yours.',
      href: '/dashboard/production',
      linkLabel: 'See open tasks',
    },
    {
      title: 'Items come from a shoot',
      body: 'Once a shoot is locked, its items are created from the shoot page and appear on your Editor board.',
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
      title: 'Your work goes in Versions',
      body: 'Drop the export in, or paste a link, then save. Each save is a new version; the latest one is what gets reviewed.',
      href: '#work',
      linkLabel: 'Jump to Versions',
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
