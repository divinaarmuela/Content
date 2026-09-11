/**
 * THE FIRST-DAY TUTORIAL — what you are looking at, and what to DO, in order.
 *
 * The owner, 9 Sep 2026: "if they are signed in for the first time create a
 * tutorial page for them to use … a proper tutorial which tells them what
 * they should do … they should know what they are looking at. That getting
 * started is not a good one." So this is not three links in a panel. It is
 * a walk through the job, one step at a time: each step first describes the
 * screen — what the columns are, what a card is, what the button reads —
 * and then says what to press and what happens next, in the words the
 * screen uses, with the real page one press away.
 *
 * Every label quoted here — "New post", "Send for approval", "Approved
 * media", "Upload", "Ready to post", "Post approval", "Schedule", "Shoot
 * brief boards", "Pick a client" — is the label the screen draws today
 * (Shell.tsx, board-core.ts, schedule-compose-core.ts,
 * schedule-upload-core.ts, useSchedulePosts). A step that tells somebody to
 * press a button that is not there is worse than no tutorial;
 * `tests/tutorial-core.test.ts` pins the ones that can be pinned.
 *
 * Pure: no I/O, no React. The page draws it; the getting-started API stores
 * "done" under the same per-role key the panels use, so a promotion earns
 * the new job's tutorial once.
 */

import type { Role } from './identity-core'

export type TutorialStep = {
  /** what this step is about, as a heading */
  title: string
  /** WHAT YOU ARE LOOKING AT — the screen, described: its parts and what each means */
  see: string[]
  /** what to do, in order — imperative, in the screen's own words */
  actions: string[]
  /** what they should see once it is done */
  result?: string
  /** the real page this step happens on */
  href?: string
  linkLabel?: string
}

export type Tutorial = {
  /** the job, in one line */
  job: string
  intro: string
  steps: TutorialStep[]
  /** where "I'm ready" lands them */
  home: string
  homeLabel: string
}

const SCHEDULE = '/dashboard/social/schedule'

const SCHEDULER: Tutorial = {
  job: 'Get the team’s approved work onto the client’s accounts, on time.',
  intro: 'Two pages are yours: Post approval, which is your board, and Schedule, which is the posting calendar. Everything below happens on one of the two.',
  home: SCHEDULE,
  homeLabel: 'Open the Schedule page',
  steps: [
    {
      title: 'Your board: Post approval',
      see: [
        'Five columns, left to right: Draft, Internal check, With client, Ready to post, Posted. A card moves right as it gets checked.',
        'Each card is ONE piece — a reel, a carousel, a graphic — for one client. It shows the client, what it is, who has it, and a link to the files.',
        'Only Ready to post has been signed off. Everything left of it is still being made or checked by someone else.',
        'A card with "Waiting on you" means somebody tagged you in its comments with a question.',
      ],
      actions: [
        'Open Post approval in the sidebar.',
        'Find the Ready to post column. Those are the pieces you can post.',
        'Open one card and read it: the caption if there is one, the files, the due date, any comments.',
      ],
      result: 'You know what is ready to go out, and what is still with someone else.',
      href: '/dashboard/scheduler',
      linkLabel: 'Open Post approval',
    },
    {
      title: 'The Schedule page: one client’s posting calendar',
      see: [
        'A week of days across the top and hours down the side. Each tile on it is one planned post at one time.',
        '"Pick a client" at the top: the calendar is per client, and nothing on it means anything until one is chosen.',
        'The rail on the side lists the client’s approved media — the pieces from Ready to post — waiting to be given a time.',
        'Every time shown here is in the client’s time zone, not yours.',
      ],
      actions: [
        'Open Schedule in the sidebar.',
        'Choose the client with "Pick a client".',
        'Move to the week you are posting into.',
      ],
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: '"New post" — where a post starts',
      see: [
        'The New post window has three sources across the top: "Approved media" (pieces already signed off on the board), "Upload" (files from your own device), and "Google Drive".',
        'Below them, the files you have picked, in the order they will show. Several files in one post is a carousel.',
        'A line under the files says what will happen next — sent to a manager, or booked in — depending on who you are.',
      ],
      actions: [
        'Press New post.',
        'Choose a source and pick the photos or video.',
        'Put them in the order they should show.',
      ],
      result: 'The post window opens with your media in it.',
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'The post window: caption, channels, time',
      see: [
        'The media on the left; the caption box; a tab per channel so one network can have its own words or files.',
        'The channels: every account connected for this client — Instagram, Facebook, TikTok, LinkedIn, YouTube and so on — with a tick box each.',
        'The day and time picker, in the client’s time zone.',
        'A line under the media that states each network’s limits — length, size, how many files — and says plainly if a file will not post there.',
        'One button at the bottom. Its label tells you what it does: for you it reads Send for approval.',
      ],
      actions: [
        'Write the caption.',
        'Tick the channels it goes to.',
        'Set the day and time.',
        'Read the line under the media before you press anything — a refused file is said here, not after.',
      ],
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Send it for approval',
      see: [
        'You do not approve posts; an account manager or a super admin does. So your button reads Send for approval, and it asks you who.',
        'After you press it the tile on the calendar says it is waiting, and on whom.',
        'A manager’s answer comes back on the post — approved, or a note saying what to change.',
      ],
      actions: [
        'Press Send for approval and pick the account manager.',
        'Wait for their email — you get one either way.',
        'If they asked for changes, read the note on the post, change it, and press Send again.',
      ],
      result: 'Once approved it is booked in at the time you chose. Nothing else to press.',
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Already approved on the board? Just schedule it',
      see: [
        'A piece that reached Ready to post has already been checked, so for it the button does not ask anyone: it reads Schedule, or Post now if the time is right now.',
      ],
      actions: [
        'In New post choose "Approved media" and pick the piece.',
        'Write the caption, tick the channels, set the time.',
        'Press Schedule.',
      ],
      result: 'It is booked in. No one else has to press anything.',
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Booked in is not posted',
      see: [
        'A booked tile has a time. A posted tile has gone live — the tile changes when it does, and says so if a network refused it.',
        'The usual reasons for a refusal: a file the network would not take, or a channel whose connection has expired and needs reconnecting.',
        'On your board the same piece shows the stage: "Booked in" when it has a time, "Posted" once it is live.',
      ],
      actions: [
        'After the time passes, check the tile.',
        'If it failed, read why on the tile, fix that, and schedule it again.',
        'On the card, press "Booked in" when it has a time and "Posted" once it is live, so the board tells the truth.',
      ],
      href: '/dashboard/scheduler',
      linkLabel: 'Open Post approval',
    },
    {
      title: 'Where answers arrive',
      see: [
        'Notifications, in the sidebar: every approval, every "please change this", every @mention, newest first. Each one opens the card it is about.',
        'Comments on a card: the conversation about that piece. Typing @ and a name asks that person, who is emailed and gets a "Waiting on you" card until they answer.',
      ],
      actions: [
        'Open Notifications once a day at least.',
        'To ask a question, open the card, go to Comments, type @ and the name.',
      ],
      href: '/dashboard/notifications',
      linkLabel: 'Open Notifications',
    },
  ],
}

const EDITOR: Tutorial = {
  job: 'Make the pieces on your cards and hand each one on for checking.',
  intro: 'Your board is the Editor page. Every card on it is one thing to make, and it moves left to right as it gets checked.',
  home: '/dashboard/editor',
  homeLabel: 'Open my board',
  steps: [
    {
      title: 'Your board: Editor',
      see: [
        'Columns left to right: Draft, Internal check, With client, then Ready to post and Posted folded away at the end.',
        'Each card is ONE thing to make — one reel, one carousel, one graphic. Four reels is four cards.',
        'You only see what is yours: cards assigned to you, cards you made, cards someone tagged you on, and the cards of a shoot you own.',
        'A card says the client, what to make, the due date, who has it, and links to the shoot folder.',
      ],
      actions: [
        'Open Editor in the sidebar.',
        'Open a card in Draft and read it top to bottom.',
      ],
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
    {
      title: 'The card: where the link goes',
      see: [
        'The top of the card says whose move it is and shows one blue button for it. Greyed out means something is missing, and the line under it says what.',
        'The "work" section holds the link to the finished piece — the card carries a link, not the file.',
        'Replacing the link makes a new version. The latest version is what gets checked.',
      ],
      actions: [
        'Make the piece in your own tools.',
        'Paste the Google Drive or Dropbox link on the card and save.',
      ],
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
    {
      title: 'Hand it on',
      see: [
        'The button reads "Ready for checking". Pressing it moves the card to Internal check, where an account manager looks at it.',
        'A card that comes back sits in Draft again with the manager’s note on it, in their words.',
      ],
      actions: [
        'Press "Ready for checking".',
        'Watch your email: you are told when it is approved, or when it comes back.',
        'If it comes back, read the note, change the piece, replace the link, press "Ready for checking" again.',
      ],
      href: '/dashboard/editor',
      linkLabel: 'Open my board',
    },
    {
      title: 'Shoots and shoot plans',
      see: [
        'Shoots is where filming days live. One card is one shoot, in six columns from Draft to Footage handed over.',
        'Open a shoot for its plan: the concept, shot list and references on the planning board — the one the client sees on their portal — plus who has read it and the go-ahead.',
        'You see the shoots you are on and the plans you made or were given.',
      ],
      actions: [
        'Open Shoots in the sidebar.',
        'To plan a shoot yourself: press New shoot plan. Making the plan sets up the shoot too.',
      ],
      href: '/dashboard/production',
      linkLabel: 'Open Shoots',
    },
    {
      title: 'Where answers arrive',
      see: [
        'Notifications: approvals, changes and @mentions, newest first, each opening its card.',
        'Comments on a card: type @ and a name to ask someone; they are emailed and get a "Waiting on you" card until they answer.',
      ],
      actions: [
        'Open Notifications in the sidebar.',
        'Ask questions on the card, not in a separate chat — the answer stays with the work.',
      ],
      href: '/dashboard/notifications',
      linkLabel: 'Open Notifications',
    },
  ],
}

const GENERAL: Tutorial = {
  job: 'Do the cards that are yours — and book your own in when they are ready.',
  intro: 'You see the work assigned to you, the work you made, and the shoots you own. A card you own is yours to carry from Draft all the way to Posted.',
  home: '/dashboard/production',
  homeLabel: 'Open Shoots',
  steps: [
    {
      title: 'Three pages, one piece of work',
      see: [
        'Shoots: every filming day, from the first plan to the footage handed over.',
        'Editor: everything being made — pieces and tasks — from In progress to Done.',
        'Schedule: the posting calendar for one client at a time.',
        'The same card can appear on more than one of them, wearing a different hat on each.',
      ],
      actions: [
        'Open each of the three from the sidebar once, so you know the shape of them.',
      ],
      href: '/dashboard/production',
      linkLabel: 'Open Shoots',
    },
    {
      title: 'Make a card, or take one',
      see: [
        'New card on the Editor page makes a task or a piece; New shoot plan on Shoots makes a shoot.',
        'A card you make stays on your board even if you hand it to someone else.',
        'A card with nobody on it says "Nobody yet".',
      ],
      actions: [
        'Press New card on the Editor page and choose what you are making.',
        'Name it for what it is; paste the link when the work is ready.',
      ],
      href: '/dashboard/editor',
      linkLabel: 'Open the Editor page',
    },
    {
      title: 'Add the link and hand it on',
      see: [
        'The card carries a link to the finished piece, not the file. Replacing the link makes a new version.',
        'The button reads "Ready for checking"; pressing it sends the card to an account manager’s Internal check column.',
      ],
      actions: [
        'Paste the link on the card and save.',
        'Press "Ready for checking". You are emailed when it is approved or comes back with changes.',
      ],
      href: '/dashboard/editor',
      linkLabel: 'Open the Editor board',
    },
    {
      title: 'Book your own piece in',
      see: [
        'Once approved, your piece is in Ready to post and in the Schedule page’s "Approved media".',
        'Because you own it, the button in the post window reads Schedule — it does not ask anyone. You are the one notified when it moves, not a scheduler.',
      ],
      actions: [
        'Open Schedule, pick the client, press New post, choose "Approved media" and pick the piece.',
        'Write the caption, tick the channels, set the time, press Schedule.',
      ],
      result: 'It is booked in. The tile changes when it goes live.',
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Where answers arrive',
      see: [
        'Notifications: approvals, changes and @mentions, each opening its card.',
        'Comments on a card: type @ and a name to ask someone a question.',
      ],
      actions: [
        'Open Notifications in the sidebar.',
      ],
      href: '/dashboard/notifications',
      linkLabel: 'Open Notifications',
    },
  ],
}

const MANAGER: Tutorial = {
  job: 'Run your clients: plan the shoots, check the work, get it posted.',
  intro: 'You see everything for the clients you manage (a super admin sees every client). Most of your day is three places: Shoots, the Post approval board, and Schedule.',
  home: '/dashboard',
  homeLabel: 'Open the Overview',
  steps: [
    {
      title: 'The Overview and your clients',
      see: [
        'The Overview: this month at a glance — what each client is owed under their agreement and what has gone out.',
        'Clients: one page per client — who manages them, their connected channels, their portal link, and the switch "This client signs off every post".',
      ],
      actions: [
        'Open Clients and open one client’s page. Check the manager and the channels are right.',
      ],
      href: '/dashboard/clients',
      linkLabel: 'Open Clients',
    },
    {
      title: 'Shoots: plan a shoot',
      see: [
        'One card per shoot for your clients, in the playbook’s six columns: Draft, Shared with team, Confirmed, Reminder sent, Shoot day, Footage handed over.',
        'A shoot plan is the concept and shot list for one filming day, drawn on a planning board — the same board the client sees, open, on their portal once you share it.',
        'Open a shoot for the nine-part checklist, who has read the plan, the plan’s own sign-off, and Go. By date shows the same shoots on a calendar.',
      ],
      actions: [
        'Press New shoot plan. Making the plan sets up the shoot; you never create the shoot separately.',
        'Write the concept and shot list, then share the plan with the client.',
        'Once they approve, open the plan and book the filming date.',
      ],
      href: '/dashboard/production',
      linkLabel: 'Open Shoots',
    },
    {
      title: 'The Editor board: your column is Internal check',
      see: [
        'Five columns from Draft to Posted. Anything in Internal check is waiting on you.',
        'A card with "Nobody yet" has no editor. Opening it lets you hand it to a named editor, who is emailed the job.',
        'Once the client signs a piece off it moves to Ready to post and off this board for you.',
      ],
      actions: [
        'Open Editor and go to Internal check.',
        'Open the link, look at the piece, then send it to the client for their answer — or send it back with what needs changing, in your own words on the card.',
      ],
      href: '/dashboard/editor',
      linkLabel: 'Open the Editor board',
    },
    {
      title: 'Schedule: post it — no one else’s approval needed',
      see: [
        'The posting calendar for one client: a week across the top, hours down the side, a tile per planned post.',
        'New post takes a piece from "Approved media", a file uploaded straight from your device, or Google Drive.',
        'For you the button at the bottom reads Schedule, or Post now if the time is now. One press books it in; the app records you as the one who signed it off.',
        'If the client’s page says they sign off every post, that sentence appears under the button as a reminder. It does not stop you.',
      ],
      actions: [
        'Open Schedule, pick the client, press New post, choose the media.',
        'Write the caption, tick the channels, set the time, press Schedule.',
        'To have the client see it first instead, choose Send for approval from the menu next to the button.',
      ],
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Post approval: what a scheduler sends you',
      see: [
        'A scheduler cannot approve a post. Theirs arrive as "Send for approval" and wait for you, showing who sent it and when it is meant to go out.',
      ],
      actions: [
        'Open Post approval.',
        'Approve it — it is booked in at their time, nothing else to press — or send it back with a note.',
      ],
      href: '/dashboard/scheduler',
      linkLabel: 'Open Post approval',
    },
    {
      title: 'The client’s portal',
      see: [
        'Each client has a share link on their page. It opens without an account.',
        'On it: their shoot first, with the planning board open at full width; then the posts waiting on them; then the work in review.',
        'Their answers and comments come back to you in Notifications and on the card.',
      ],
      actions: [
        'Open a client’s page, find the portal link, and look at it once as they will.',
      ],
      href: '/dashboard/notifications',
      linkLabel: 'Open Notifications',
    },
  ],
}

/** The tutorial for a role — none for a client (the portal is theirs). */
export function tutorialFor(role: Role | null | undefined): Tutorial | null {
  switch (role) {
    case 'scheduler': return SCHEDULER
    case 'editor': return EDITOR
    case 'general': return GENERAL
    case 'account_manager':
    case 'super_admin': return MANAGER
    default: return null
  }
}

/** The key "done" is stored under — per role, like the panels, so a
 *  promotion earns the new job's tutorial once. */
export const tutorialKey = (role: Role) => `${role}:start`

/**
 * The roles whose FIRST sign-in opens the tutorial by itself. The owner asked
 * for it for schedulers ("this is only for scheduler right"); every other
 * role's tutorial waits in the sidebar under How this works. Widening this
 * is adding a role to the list.
 */
export const AUTO_OPEN_ROLES: readonly Role[] = ['scheduler']

/**
 * Open the tutorial for this person on arrival? Only a role in
 * AUTO_OPEN_ROLES, only the first time in that role — and never for a
 * client, who has no dashboard to learn.
 */
export function shouldOpenTutorial(
  role: Role | null | undefined,
  dismissedPages: readonly string[] | null | undefined,
): boolean {
  if (!role || tutorialFor(role) === null || !AUTO_OPEN_ROLES.includes(role)) return false
  return !(dismissedPages ?? []).includes(tutorialKey(role))
}

/** Which step to show, clamped to the tutorial. */
export function clampStep(step: number, total: number): number {
  if (!Number.isFinite(step) || total <= 0) return 0
  return Math.min(Math.max(Math.trunc(step), 0), total - 1)
}
