import type { Role } from './identity-core'

/**
 * The three things a new hire needs on their first day, per role — and
 * per PAGE, because the first day happens on four different screens.
 *
 * Rewritten 11 Sep 2026 to the pages as they run now (the playbook build:
 * Shoots, the Editor and Post approval columns, the quality check, the
 * Booked in column). Every sentence names a button or a column the screen
 * draws today; `tests/getting-started-pages.test.ts` sweeps it for jargon
 * and `tests/tutorial-core.test.ts` pins the labels.
 *
 * Pure data so the copy can be tested. The panel that renders it is
 * app/dashboard/GettingStarted.tsx.
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
export type GettingStartedPage = 'overview' | 'editor' | 'scheduler' | 'production' | 'item' | 'start'

const HEADING = 'New here? Three things to know.'

const EDITOR: GettingStartedPanel = {
  heading: HEADING,
  steps: [
    {
      title: 'Find your work',
      body: 'Every card handed to you is on your board, in the playbook’s four columns: In Progress, For Review, For Handoff, Done. One card is one shoot’s work. Press Acknowledge on a new one so the team knows you are on it.',
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
    {
      title: 'Put the final on the card, then hand it on',
      body: 'Under Versions, upload the export or press "Pick the final from Google Drive", add the Dropbox link to the source files, then press "Ready for checking". The account manager checks it, then the quality reviewer.',
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
    {
      title: 'Watch for changes, and flag a risk early',
      body: 'A card that comes back shows what to change, in the reviewer’s words, right on the card. If a date is at risk, press "Flag a deadline risk" the moment you see it.',
      href: '/dashboard/notifications',
      linkLabel: 'See what came back',
    },
  ],
}

const SCHEDULER: GettingStartedPanel = {
  heading: HEADING,
  steps: [
    {
      title: 'See what is ready',
      body: 'Ready to post is your queue: cards handed to you, checked by the quality reviewer and approved by the client. Everything left of it is still with someone else. A green "Your turn" means it was handed to you by name.',
      href: '/dashboard/scheduler',
      linkLabel: 'See the board',
    },
    {
      title: 'Book it on the Schedule page',
      body: 'Pick the client, press New post, choose "Approved media", tick the channels, write the caption, set the time, press Schedule. The card moves to Booked in by itself.',
      href: '/dashboard/social/schedule',
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Booked in is not posted',
      body: 'Booked in means the channel has it and a time is set. Posted means it is live on every channel. The Posts page says what happened on each one, and why if it did not go out.',
      href: '/dashboard/social/activity',
      linkLabel: 'Open Posts',
    },
  ],
}

const ACCOUNT_MANAGER: GettingStartedPanel = {
  heading: HEADING,
  steps: [
    {
      title: 'Your clients',
      body: 'One page per client: who manages them, who schedules for them, their channels and their portal link. The Overview shows what is on you today and this month’s produced, delivered and published per client.',
      href: '/dashboard/clients',
      linkLabel: 'See my clients',
    },
    {
      title: 'Check, then send for quality check',
      body: 'Cards in Internal check on Post approval are waiting on a manager. Check caption, message, cover and timing, then press "Send for quality check" — or "Ask for changes". The quality reviewer sends it to the client.',
      href: '/dashboard/scheduler',
      linkLabel: 'Review what is waiting',
    },
    {
      title: 'Plan the next shoot',
      body: 'On Shoots, press New shoot plan, fill the nine parts, pick the editor and crew, share the plan seven days before the day, and press Go once everyone has read it.',
      href: '/dashboard/production',
      linkLabel: 'Open Shoots',
    },
  ],
}

/** The Editor board as a MANAGER sees it: every card being made for their clients. */
const EDITOR_PAGE_FOR_MANAGERS: GettingStartedPanel = {
  heading: 'The Editor board, for managers',
  steps: [
    {
      title: 'Every card being made',
      body: 'One card per shoot’s work, for your clients, in the editors’ four columns: In Progress, For Review, For Handoff, Done. Filter by Client or People to see who is doing what.',
      href: '/dashboard/editor',
      linkLabel: 'See the board',
    },
    {
      title: 'Nobody on it? Give it to someone',
      body: 'A card with "Nobody yet" has no editor. Open it and press "Hand to…" to give it to a named editor, who is emailed the job. New card makes a fresh one, with "Files to work from" for them.',
      href: '/dashboard/editor',
      linkLabel: 'Find unassigned cards',
    },
    {
      title: 'Your checking happens on Post approval',
      body: 'When an editor presses "Ready for checking" the card lands in Internal check on Post approval. That is where you send it for quality check, or ask for changes.',
      href: '/dashboard/scheduler',
      linkLabel: 'Open Post approval',
    },
  ],
}

const PRODUCTION_FOR_MANAGERS: GettingStartedPanel = {
  heading: 'Shoots, in three steps',
  steps: [
    {
      title: 'Make a shoot plan',
      body: 'Press New shoot plan: the client, a title, what the shoot is for, the date. Making the plan sets up the shoot too. You never create the shoot separately.',
    },
    {
      title: 'Fill it in, share it seven days out',
      body: 'Open the shoot: fill the nine parts of the plan, pick the editor and crew, then share it with the team at least seven days before the day. A late plan turns red and Ops is told. The card moves right as each step is done.',
    },
    {
      title: 'Go, shoot, hand over',
      body: 'Once everyone has pressed "I’ve read the plan", press "Confirm — it is go" — that books the date. The day before, Reminder sent emails call time and location. After the day, move the shoot to Footage handed over and the editor gets their cards.',
    },
  ],
}

/** Shoots for the people on them — editors and crew — and for a general user. */
const PRODUCTION_FOR_CREW: GettingStartedPanel = {
  heading: 'Shoots, in three steps',
  steps: [
    {
      title: 'A shoot is one card',
      body: 'One filming day: the date, the location, the shot list and the plan, in six stages from Draft to Footage handed over. Open a shoot to read its plan on the canvas.',
      href: '/dashboard/production',
      linkLabel: 'See the shoots',
    },
    {
      title: 'Read the plan and say so',
      body: 'Open the shoot and press "I’ve read the plan". The shoot cannot be confirmed until everyone on it has.',
      href: '/dashboard/production',
      linkLabel: 'See the shoots',
    },
    {
      title: 'Your cards are on the Editor page',
      body: 'When the footage is handed over, the cards for that shoot land on your Editor page, owned by you, with the deadline on them. Press New card there for anything else you are making.',
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
      body: 'It names whose move it is and shows one button for it. If the button is greyed out, the line under it says what is missing.',
      href: '#next',
      linkLabel: 'Jump to it',
    },
    {
      title: 'Put the final on the card',
      body: 'Upload the export, pick it from Google Drive, or paste a link where the work lives. Each upload is a new version; the latest one is what gets checked.',
      href: '#work',
      linkLabel: 'Jump to the files',
    },
    {
      title: 'Tag someone to ask a question',
      body: 'In the notes, type @ and a name. They get an email and a "Waiting on you" line until they mark it done.',
      href: '#comments',
      linkLabel: 'Jump to the notes',
    },
  ],
}

/** The Post approval board for a GENERAL user: their own cards through
 *  every stage, and the unclaimed queue. */
const SCHEDULER_PAGE_FOR_GENERAL: GettingStartedPanel = {
  heading: HEADING,
  steps: [
    {
      title: 'Your cards, as they get checked',
      body: 'Draft, Internal check, Quality check, With client, Ready to post, Booked in, Posted. Your own cards show through every stage; Ready to post with nobody named is yours to take.',
      href: '/dashboard/scheduler',
      linkLabel: 'See the board',
    },
    {
      title: 'You make, others check',
      body: 'Press "Ready for checking" on your card and the account manager checks it, then the quality reviewer, then the client. You are emailed at each step.',
      href: '/dashboard/editor',
      linkLabel: 'Open the Editor page',
    },
    {
      title: 'Book your own piece in',
      body: 'Once it has passed, book it on the Schedule page: New post, "Approved media", channels, caption, time, Schedule. The card moves to Booked in by itself.',
      href: '/dashboard/social/schedule',
      linkLabel: 'Open the Schedule page',
    },
  ],
}

/**
 * Which panel a role sees on the Overview. Super admins get the account-
 * manager one — they do that job too, and inventing a fourth panel for one
 * person is copy that never gets maintained. A general user gets the Post
 * approval one for their role. Clients get nothing: this is staff onboarding.
 */
export function panelForRole(role: Role | null): GettingStartedPanel | null {
  switch (role) {
    case 'editor': return EDITOR
    case 'scheduler': return SCHEDULER
    case 'general': return SCHEDULER_PAGE_FOR_GENERAL
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
    case 'editor': return manager ? EDITOR_PAGE_FOR_MANAGERS : (role === 'editor' || role === 'general') ? EDITOR : null
    case 'scheduler': return role === 'scheduler' ? SCHEDULER : role === 'general' ? SCHEDULER_PAGE_FOR_GENERAL : manager ? ACCOUNT_MANAGER : null
    case 'production': return manager ? PRODUCTION_FOR_MANAGERS : PRODUCTION_FOR_CREW
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
