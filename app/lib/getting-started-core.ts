import type { Role } from './identity-core'

/**
 * The three things a new hire needs on their first day, per role.
 *
 * Until now the app explained itself nowhere: no tour, no first-run panel, no
 * `?`, no glossary. Every invented word had to be learned by asking a
 * colleague. This is the smallest honest fix — three steps, each a real link,
 * on the page that role lands on.
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
      title: 'Attach it, then submit it',
      body: 'Open an item, add the file or a link, then press Submit for review. An account manager checks it next.',
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

/**
 * Which panel a role sees. Super admins get the account-manager one — they do
 * that job too, and inventing a fourth panel for one person is copy that never
 * gets maintained. Clients get nothing: this is staff onboarding.
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
