/**
 * THE FIRST-DAY TUTORIAL — what you are looking at, and what to DO, in order.
 *
 * The owner, 9 Sep 2026: "if they are signed in for the first time create a
 * tutorial page for them to use … a proper tutorial which tells them what
 * they should do … they should know what they are looking at." And on 11
 * Sep, after the playbook build: "revamp the tutorial pages — currently I
 * know it's broken and not updated."
 *
 * So this is a walk through the job as the app runs it TODAY, one step at a
 * time: each step first describes the screen — the columns, what a card
 * is, what the button reads — and then says what to press and what happens
 * next, in the words the screen uses, with the real page one press away.
 *
 * The flow every tutorial follows is the Team's Playbook plus Abby's rule
 * of 11 Sep 2026: AM / designer / editor → Joy (the quality check) →
 * scheduler. Every label quoted here is the label the screen draws
 * (Shell.tsx, board-core.ts, workflow-core.ts, shoot-sop-core.ts,
 * schedule-compose-core.ts); `tests/tutorial-core.test.ts` pins the ones
 * that can be pinned, so a rename fails a test rather than a first day.
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
  /** where "I'm ready" lands them — their first page */
  home: string
  homeLabel: string
}

const SCHEDULE = '/dashboard/social/schedule'
const POST_APPROVAL = '/dashboard/scheduler'
const EDITOR_PAGE = '/dashboard/editor'
const SHOOTS = '/dashboard/production'
const POSTS = '/dashboard/social/activity'
const NOTIFICATIONS = '/dashboard/notifications'

/** The Post approval columns, as the board draws them — quoted in more than
 *  one tutorial, so said once. */
export const POST_APPROVAL_COLUMNS = 'Draft, Internal check, Quality check, With client, Ready to post, Booked in, Posted'
/** The Editor columns. */
export const EDITOR_COLUMNS = 'In progress, For review, Quality check, With client, For handoff, Done'
/** The Shoots columns. */
export const SHOOT_COLUMNS = 'Draft, Shared with team, Confirmed, Reminder sent, Shoot day, Footage handed over'

const WHERE_ANSWERS_ARRIVE: TutorialStep = {
  title: 'Where answers arrive',
  see: [
    'Notifications, in the sidebar: every approval, every "please change this", every @mention, newest first. Each one opens the card it is about.',
    'Notes on a card: the conversation about that piece. Typing @ and a name asks that person; they are emailed and see "Waiting on you" until they answer.',
    'Every email the app sends you has a link straight to the card.',
  ],
  actions: [
    'Open Notifications once a day at least.',
    'To ask a question, open the card and type @ and the name in the note box.',
  ],
  href: NOTIFICATIONS,
  linkLabel: 'Open Notifications',
}

const SCHEDULER: Tutorial = {
  job: 'Get the team’s checked work onto the client’s accounts, on time.',
  intro: 'Three pages are yours: Post approval, where the cards handed to you wait; Schedule, the posting calendar; and Posts, which says what went out. Everything below happens on one of the three.',
  home: POST_APPROVAL,
  homeLabel: 'Open Post approval',
  steps: [
    {
      title: 'Your board: Post approval',
      see: [
        `Seven columns, left to right: ${POST_APPROVAL_COLUMNS}. A card moves right as it gets checked.`,
        'Each card is ONE piece — a reel, a carousel, a graphic — for one client. It shows the client, what it is, who has it, the due date and "Sent to client" once the client has seen it.',
        'You see the cards handed to you, plus anything you uploaded yourself. Ready to post is your queue: everything left of it is still being made or checked by someone else.',
        'A green "Your turn" means a card was handed to you by name. A card in Ready to post with nobody named can be taken by any scheduler.',
      ],
      actions: [
        'Open Post approval in the sidebar.',
        'Find the Ready to post column. Those are the pieces you can book.',
        'Open one card and read it: the files, the caption if there is one, the due date, the notes, and who the account manager is.',
      ],
      result: 'You know what is ready to go out, and what is still with someone else.',
      href: POST_APPROVAL,
      linkLabel: 'Open Post approval',
    },
    {
      title: 'The Schedule page: one client’s posting calendar',
      see: [
        'A week of days across the top and hours down the side. Each tile on it is one planned post at one time.',
        '"Pick a client" at the top: the calendar is per client, and nothing on it means anything until one is chosen.',
        'The rail on the left lists the client’s approved files — the pieces from Ready to post — waiting to be given a time. "Waiting for approval" at the bottom opens the List narrowed to posts a reviewer still has; "Drafts" is what you saved and left.',
        'Every time shown here is in the client’s time zone, not yours. "Night hours" shows midnight to 5 am.',
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
        'The New post window has three sources across the top: "Approved media" (pieces already checked on the board), "Upload" (files from your own device), and "Google Drive" (a file from the client’s folder — a copy is taken, nothing in Drive is touched).',
        'Below them, the files you have picked, in the order they will show. Several files in one post is a carousel.',
        'You can also open a folder in the rail, tick the files you want and press Post, or drag a folder onto a time on the calendar.',
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
      title: 'The post window: channels, kind, cover, caption, time',
      see: [
        'The channels first: every account connected for this client — Instagram, TikTok, Facebook, LinkedIn, YouTube and so on — with a tick box each.',
        'The kind of post: leave it on Auto publish and each network decides, or choose Reel, Story, Carousel or Trial Reel. A Trial Reel is Instagram only and needs an account with 1,000 followers.',
        'The cover: for a video, choose the frame people see before they press play, or upload a picture of your own.',
        'The caption box, and "More options" with each network’s own settings — only the ones that network really has.',
        'A line under the media says what each channel will do with your files, and says plainly if a file will not post there. Preview shows the post the way each network will.',
        'The day and time picker, in the client’s time zone. If clean copies of a video are still being made, the clock starts at the earliest safe time.',
        'One button at the bottom. Its label tells you what it does: for a piece checked on the board it reads Schedule, or Post now if the time is right now.',
      ],
      actions: [
        'Tick the channels it goes to.',
        'Write the caption.',
        'Set the day and time.',
        'Read the line under the media before you press anything — a refused file is said here, not after.',
        'Press Schedule.',
      ],
      result: 'It is booked in. On the board the card moves to Booked in.',
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Your own uploads go through the check like everything else',
      see: [
        'You can upload something of your own on Post approval with New post, or in the post window from Upload.',
        'You do not approve posts. A piece you uploaded goes to an account manager, then to the quality reviewer, and comes back to Ready to post once it has passed — so your button on it reads Send for approval, and it asks you who.',
        'A manager’s answer comes back on the card — passed on, or a note saying what to change.',
      ],
      actions: [
        'Press Send for approval and pick the account manager.',
        'Wait for their email — you get one either way.',
        'If they asked for changes, read the note on the card, change it, and send it again.',
      ],
      result: 'Once it has passed the quality check and the client, it is back in Ready to post for you to book.',
      href: POST_APPROVAL,
      linkLabel: 'Open Post approval',
    },
    {
      title: 'Booked in is not posted',
      see: [
        'Booked in means the channel has it and a time is set. Posted means every channel has it live — the card moves to Posted by itself when the channel says so.',
        'On the Schedule page a booked tile has a time; a posted tile has gone live, and says so if a network refused it.',
        'The usual reasons for a refusal: a file the network would not take, or a channel whose connection has expired and needs reconnecting.',
        'A booked post can still be moved by dragging it to another time on the calendar.',
      ],
      actions: [
        'After the time passes, check the tile.',
        'If it failed, read why on the tile, fix that, and schedule it again.',
        'If you posted a file yourself, outside the app, open the card and mark it "Posted by hand" with the link, so the card and the client know.',
      ],
      href: POST_APPROVAL,
      linkLabel: 'Open Post approval',
    },
    {
      title: 'Posts: what actually went out',
      see: [
        'Three piles: Scheduled, Did not post, Posted. One row per post, with a line per channel saying what kind of post it was and what happened to it.',
        'A refused channel shows the reason in plain words, with Send again. A booked post can be cancelled here while the channel still holds it.',
        'The last 30 days per client along the top: posted, scheduled, did not post.',
      ],
      actions: [
        'Open Posts in the sidebar once a day.',
        'On anything in Did not post, read the reason, fix it, press Send again.',
      ],
      href: POSTS,
      linkLabel: 'Open Posts',
    },
    WHERE_ANSWERS_ARRIVE,
  ],
}

const EDITOR: Tutorial = {
  job: 'Make the pieces on your cards and hand each one on for checking.',
  intro: 'Your board is the Editor page. Every card on it is one thing to make — for editors and designers alike — and it moves left to right as it gets checked. Shoots is where you read the plan for a filming day you are on.',
  home: EDITOR_PAGE,
  homeLabel: 'Open my board',
  steps: [
    {
      title: 'Your board: Editor',
      see: [
        `Columns left to right: ${EDITOR_COLUMNS}. Done holds what is booked or posted, folded away.`,
        'Each card is ONE thing to make — one reel, one carousel, one graphic. Four reels is four cards.',
        'You only see what is yours: cards handed to you, cards you made, and cards someone tagged you on.',
        'A card says the client, the account manager, what to make, which shoot it is from, the due date, and "Files to work from" when a manager attached footage or a folder.',
        'A new card says "New — press Acknowledge". Pressing it tells the team you are on it, the same day it lands, as the playbook asks.',
      ],
      actions: [
        'Open Editor in the sidebar.',
        'Open a card in In progress and read it top to bottom.',
        'Press Acknowledge.',
      ],
      href: EDITOR_PAGE,
      linkLabel: 'Open my board',
    },
    {
      title: 'The card: the final goes on it',
      see: [
        'Under "Files to work from" is what the manager gave you: footage, stills, or the Drive or Dropbox folder they live in. Open them from there.',
        'Under "Versions" is where your finished piece goes. Three ways in: Upload (the export from your device), "Pick the final from Google Drive" (a copy is taken from the client’s folder — nothing in Drive is touched), or a pasted link.',
        'Only pictures and videos are taken — finals in the platform’s spec, watched start to finish. Never raw footage.',
        '"Source files (Dropbox)" is where the project files live, for whoever picks this up later.',
        'Each upload is a new version. The latest version is what gets checked.',
      ],
      actions: [
        'Make the piece in your own tools.',
        'Upload the final, or pick it from Google Drive.',
        'Paste the Dropbox link to the source files.',
      ],
      href: EDITOR_PAGE,
      linkLabel: 'Open my board',
    },
    {
      title: 'Hand it on, and flag a risk early',
      see: [
        'The button reads "Ready for checking". Pressing it moves the card to For review, where the account manager looks at it. From there it goes to the quality reviewer, then to the client, then to the scheduler — you do not need to do anything for those.',
        'A card that comes back sits in In progress again with the note on it, in the reviewer’s words.',
        '"Flag a deadline risk" tells the account managers in one line that the date is at risk. The playbook asks for this the moment you see it, not on the due date.',
        'A card with no file yet is refused with "Attach the work first" — upload the final, then press again.',
      ],
      actions: [
        'Press "Ready for checking".',
        'Watch your email: you are told when it moves on, or when it comes back.',
        'If it comes back, read the note, change the piece, upload the new version, press "Ready for checking" again.',
        'If a date is at risk, press "Flag a deadline risk" and say why in one line.',
      ],
      href: EDITOR_PAGE,
      linkLabel: 'Open my board',
    },
    {
      title: 'Shoots: read the plan, then get the footage',
      see: [
        `Shoots is where filming days live. One card is one shoot, in the playbook’s six stages: ${SHOOT_COLUMNS}.`,
        'You see the shoots you are on as the editor or the crew. Open one for the plan: the objective, the shot list, the script, call time and location, and the editor priorities and deadline.',
        'The plan is built on a Milanote-style canvas on the shoot page — shot list, references, mood board.',
        'When the account manager shares the plan you are emailed. The shoot cannot be confirmed until everyone on it has pressed "I’ve read the plan".',
        'After the shoot, when the footage is handed over, the cards for that shoot land on your Editor page — owned by you, with the deadline and the priorities from the plan — and you are emailed.',
      ],
      actions: [
        'When the email arrives, open the shoot and read the plan.',
        'Press "I’ve read the plan".',
        'When "Footage is in" arrives, go to Editor and press Acknowledge on the new cards.',
      ],
      href: SHOOTS,
      linkLabel: 'Open Shoots',
    },
    WHERE_ANSWERS_ARRIVE,
  ],
}

const GENERAL: Tutorial = {
  job: 'Make work for any client, get it checked, and book your own in when it has passed.',
  intro: 'You see the making-and-posting run for every client: Shoots, Editor, Post approval, Schedule and Posts, plus the Clients pages. A card you own is yours to carry from In progress all the way to Booked in. You do not do the checking: that is the account manager, then the quality reviewer.',
  home: EDITOR_PAGE,
  homeLabel: 'Open the Editor page',
  steps: [
    {
      title: 'Five pages, one piece of work',
      see: [
        `Shoots: every filming day, from the first plan to the footage handed over, in six stages: ${SHOOT_COLUMNS}.`,
        `Editor: everything being made — pieces and tasks — in the columns ${EDITOR_COLUMNS}. Your own cards, plus anything you made.`,
        `Post approval: the same cards as they get checked, in the columns ${POST_APPROVAL_COLUMNS}. Ready to post with nobody named is yours to take.`,
        'Schedule: the posting calendar for one client at a time. Posts: what went out.',
        'The same card can appear on more than one of them.',
      ],
      actions: [
        'Open each of the five from the sidebar once, so you know the shape of them.',
      ],
      href: SHOOTS,
      linkLabel: 'Open Shoots',
    },
    {
      title: 'Make a card, or plan a shoot',
      see: [
        'New card on the Editor page makes a piece or a task: pick the client, name it, say what needs doing, choose which shoot and deliverable it is from, attach files to work from, set the due date.',
        'New shoot plan on Shoots makes a shoot: pick the client, name it, say what it is for, set the shoot date. The nine parts of the plan are filled in on the plan page after that.',
        'A card you make stays on your board even if you hand it to someone else. A card with nobody on it says "Nobody yet".',
      ],
      actions: [
        'Press New card on the Editor page and fill it in.',
        'Or press New shoot plan on Shoots.',
      ],
      href: EDITOR_PAGE,
      linkLabel: 'Open the Editor page',
    },
    {
      title: 'Put the final on the card and hand it on',
      see: [
        'Under "Versions": Upload the final, "Pick the final from Google Drive", or paste a link. Pictures and videos only, in the platform’s spec.',
        'The button reads "Ready for checking"; pressing it sends the card to the account manager’s Internal check. From there the quality reviewer passes it, then the client sees it.',
        'A card with no file yet is refused with "Attach the work first".',
        'Press Acknowledge on a card that was handed to you, and "Flag a deadline risk" if a date is at risk.',
      ],
      actions: [
        'Upload the final on the card.',
        'Press "Ready for checking". You are emailed when it moves on or comes back with changes.',
      ],
      href: EDITOR_PAGE,
      linkLabel: 'Open the Editor board',
    },
    {
      title: 'Book your own piece in',
      see: [
        'Once it has passed the quality check and the client, your piece is in Ready to post and in the Schedule page’s "Approved media".',
        'For a piece that has passed, the button in the post window reads Schedule — it does not ask anyone. For a file you upload straight into the post window it reads Send for approval, because that file has not been checked yet.',
        'On the board the card moves to Booked in, and to Posted when every channel has it live.',
      ],
      actions: [
        'Open Schedule, pick the client, press New post, choose "Approved media" and pick the piece.',
        'Tick the channels, write the caption, set the time, press Schedule.',
      ],
      result: 'It is booked in. The tile changes when it goes live, and Posts says what happened on each channel.',
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'Shoots: the plan and the go-ahead',
      see: [
        'Open a shoot for the nine-part checklist ("6 of 9 filled" says what is missing), who has read the plan, the seven-day clock and Go.',
        'The plan must be shared with the team seven days before the shoot: "No brief, no shoot." A late plan turns red and Ops is told.',
        'Everyone on the shoot presses "I’ve read the plan". Go is the one sign-off — it also books the date. After the day, "Footage handed over" puts the shoot’s cards on the editor’s page.',
        'The account manager picks the editor and crew and gives the Go.',
      ],
      actions: [
        'Fill the nine parts on the plan page, on the canvas and in the fields.',
        'Press "I’ve read the plan" on any shoot you are on.',
      ],
      href: SHOOTS,
      linkLabel: 'Open Shoots',
    },
    WHERE_ANSWERS_ARRIVE,
  ],
}

const MANAGER: Tutorial = {
  job: 'Run your clients: plan the shoots, check the work, get it to the client, get it posted.',
  intro: 'You see everything for the clients you manage (a super admin sees every client). Most of your day is four places: Shoots, Editor, Post approval and the Overview. The flow is the playbook’s: you check, the quality reviewer passes, the client approves, the scheduler posts.',
  home: '/dashboard',
  homeLabel: 'Open the Overview',
  steps: [
    {
      title: 'The Overview and your clients',
      see: [
        'The Overview: what is on you today. "Needs your decision" is split into waiting on you by name and "nobody asked yet"; "Quality check" is what the reviewer has; "With clients" is what the client has; "Shoot plans late" is any shoot under seven days out whose plan is not shared.',
        'Under it, this month per client: posts per account, and produced, delivered, published against the contracted number.',
        'Clients: one page per client — who manages them, "Who schedules for this client", their connected channels, their portal link, and the switch "This client signs off every post".',
      ],
      actions: [
        'Open Clients and open one client’s page. Check the managers, the schedulers and the channels are right.',
      ],
      href: '/dashboard/clients',
      linkLabel: 'Open Clients',
    },
    {
      title: 'Shoots: plan a shoot the playbook’s way',
      see: [
        `One card per shoot for your clients, in six stages: ${SHOOT_COLUMNS}. By date shows the same shoots on a calendar.`,
        'New shoot plan makes the shoot: client, title, what it is for, shoot date. Making the plan sets up the shoot; you never create the shoot separately.',
        'On the shoot page: the nine-part checklist (objective, deliverables, shot list, script, date and call time and location, talent, props and wardrobe, client availability, editor priorities and deadline) with "6 of 9 filled" and what is missing; the Milanote-style canvas for the shot list, references and mood board; who is on the shoot; the plan’s own approval.',
        '"Editor: who edits the footage after the shoot" and "Crew on the day". Everyone you add is emailed when you share the plan and must press "I’ve read the plan".',
        'The seven-day rule: the plan must be shared with the team seven days before the day. A late plan turns red and Ops is nudged; Go is refused, and only a super admin can go anyway with a reason.',
        'Go is the one sign-off: it needs the checklist complete, "Aligned with the strategist" and client availability ticked, and every acknowledgement in. It also books the date.',
        'The day before, Ops presses "Reminder sent" and everyone gets call time and location. After the day, drag to "Footage handed over": the editor’s cards are made with the deadline and priorities from the plan, and they are emailed.',
      ],
      actions: [
        'Press New shoot plan.',
        'Fill the nine parts. Send the plan for review, or share it with the client and log their answer.',
        'Pick the editor and crew, then share the plan with the team — seven days out.',
        'Tick aligned and confirmed, wait for "2 of 2 acknowledged", press "Confirm — it is go".',
        'After the shoot, drag the card to Footage handed over.',
      ],
      href: SHOOTS,
      linkLabel: 'Open Shoots',
    },
    {
      title: 'Editor: give out the work, watch it come back',
      see: [
        `The Editor board shows every card being made for your clients, in the columns ${EDITOR_COLUMNS}.`,
        'New card makes a piece or a task for anyone: pick the client, name it, say what needs doing, which shoot and deliverable, attach "Files to work from" (footage, stills, or a Drive or Dropbox folder), set the due date and who. They are emailed.',
        'A card with "Nobody yet" has no owner. "Hand to…" gives it to an editor, who is emailed the job.',
        'An editor’s "Flag a deadline risk" reaches you as a red chip and an email.',
      ],
      actions: [
        'Press New card, or open a shoot’s handed-over cards, and make sure each has an owner and a due date.',
      ],
      href: EDITOR_PAGE,
      linkLabel: 'Open the Editor board',
    },
    {
      title: 'Post approval: your column is Internal check',
      see: [
        `Seven columns: ${POST_APPROVAL_COLUMNS}. Anything in Internal check is waiting on a manager.`,
        '"Needs a check — nobody asked yet" means no manager was named; "Ask somebody to check it" names one, and then it reads "Your turn" for them alone.',
        'Your check is the playbook’s: caption tone, message, CTA, cover, timing, platform fit. Then "Send for quality check" sends it to the quality reviewer. You cannot send it to the client yourself: only the reviewer, or a super admin standing in, passes it on.',
        '"Ask for changes" sends it back to the editor with your note, in your words.',
        'Once the reviewer passes it, the card goes With client and "Sent to client" is stamped — that is the playbook’s delivery date. The client approves on their portal, or you log their answer with "Log the client’s approval".',
        'On the client’s yes the card goes to Ready to post and is handed to the client’s schedulers by itself. Some clients post their own content: their cards stop at Delivered.',
        'Filter by Client and by People at the top to see who is doing what.',
      ],
      actions: [
        'Open Post approval and go to Internal check.',
        'Open the card, look at the files, then press "Send for quality check" — or "Ask for changes" with what needs changing.',
        'When the client answers on the portal, nothing to press. If they told you by phone, press "Log the client’s approval".',
      ],
      href: POST_APPROVAL,
      linkLabel: 'Open Post approval',
    },
    {
      title: 'Schedule and Posts: post it, and see what went out',
      see: [
        'The Schedule page is the posting calendar for one client. You can book a checked piece yourself: for it the button reads Schedule, or Post now.',
        'A file you upload straight into the post window has not been checked, so pressing Schedule sends it for quality check and says so in green. It is booked once the reviewer passes it.',
        'Posts shows what went out and what did not, channel by channel, with the reason and Send again.',
      ],
      actions: [
        'Open Schedule, pick the client, press New post, choose "Approved media", tick the channels, set the time, press Schedule.',
        'Open Posts when a client asks "did it go out?".',
      ],
      href: SCHEDULE,
      linkLabel: 'Open the Schedule page',
    },
    {
      title: 'The client’s portal',
      see: [
        'Each client has a share link on their page. It opens without an account.',
        'On it: their shoot plan first; then the posts waiting on them ("Needs your review"); then the work being made and being checked, approved, and live with each channel’s line and the numbers.',
        'The portal never names who on the team has a card, or the checking stages — only "Being made" and "Being checked".',
        'Their answers and comments come back to you in Notifications and on the card. "Reply to the client" on a card lands on their portal.',
      ],
      actions: [
        'Open a client’s page, find the portal link, and look at it once as they will.',
      ],
      href: '/dashboard/clients',
      linkLabel: 'Open Clients',
    },
    WHERE_ANSWERS_ARRIVE,
  ],
}

/**
 * The quality reviewer's own step — Joy's job, said once. A person of ANY
 * team role can be flagged (`team_users.quality_reviewer`), so this is added
 * to their base role's tutorial rather than being a tutorial of its own.
 */
export const QUALITY_REVIEWER_STEP: TutorialStep = {
  title: 'You are the quality check',
  see: [
    'Abby’s rule: every graphic, story, reel and caption passes you before it is scheduled. The flow is account manager or designer or editor, then you, then the scheduler.',
    'Every card waiting on you sits in the Quality check column on Post approval, for every client. The Overview’s "Quality check" tile counts them.',
    'Your buttons there: "Passed — send to client" (or "Passed — approve without client" for a client who does not sign off), and "Ask for changes" with a note. Nobody else can pass a card out of Quality check except a super admin standing in for you.',
    'On your pass the card is handed to the client’s schedulers by itself. You are emailed each time a card reaches Quality check.',
    'At Internal check you see one button, "Send to client": your check is the quality check, so you never send work to yourself.',
  ],
  actions: [
    'Open Post approval and go to the Quality check column, or press the Quality check tile on the Overview.',
    'Open the card. Check spelling, dates, branding, image quality and platform specs — the playbook’s list.',
    'Press "Passed — send to client", or "Ask for changes" and say what.',
  ],
  href: POST_APPROVAL,
  linkLabel: 'Open Post approval',
}

export type TutorialOptions = {
  /** `team_users.quality_reviewer`: Joy's flag, on any role */
  qualityReviewer?: boolean | null
}

/** The tutorial for a role — none for a client (the portal is theirs). A
 *  flagged quality reviewer gets their role's tutorial with the quality
 *  step added before "Where answers arrive". */
export function tutorialFor(role: Role | null | undefined, opts: TutorialOptions = {}): Tutorial | null {
  const base = baseTutorialFor(role)
  if (!base || opts.qualityReviewer !== true) return base
  const last = base.steps[base.steps.length - 1]
  const steps = last === WHERE_ANSWERS_ARRIVE
    ? [...base.steps.slice(0, -1), QUALITY_REVIEWER_STEP, last]
    : [...base.steps, QUALITY_REVIEWER_STEP]
  return { ...base, steps }
}

function baseTutorialFor(role: Role | null | undefined): Tutorial | null {
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
 * The roles whose FIRST sign-in opens the tutorial by itself. Every team
 * role (the owner, 11 Sep 2026: "when they are first signed in" — the
 * scheduler was first, and on the day the whole team signs in the rest
 * need it just as much). A client never sees the dashboard.
 */
export const AUTO_OPEN_ROLES: readonly Role[] = ['scheduler', 'editor', 'general', 'account_manager', 'super_admin']

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
