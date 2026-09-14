// THE ROLE-BY-ROLE TUTORIAL GUIDE — docs/ROLE_TUTORIAL_GUIDE.pdf
//
// The owner, 14 Sep 2026: "give me a document to go through every role — I'm
// going to do a tutorial for them — a document for each role and feature,
// what to put in and what". One section per role: the job, the pages they
// have, what they are looking at on each, what to press, what happens next,
// the emails they get, a walkthrough to demonstrate, and the refusals they
// may hit. Written from the code as it is on 14 Sep 2026 (page-access-core,
// workflow-core, the drawers), not from the older in-app tutorial text.
//
//   node scripts/role-guide.mjs
import PDFDocument from 'pdfkit'
import { createWriteStream, mkdirSync } from 'node:fs'

const OUT = 'docs/ROLE_TUTORIAL_GUIDE.pdf'
mkdirSync('docs', { recursive: true })

/* ── the content ─────────────────────────────────────────────────────────── */

const FLOW = [
  'A shoot is planned on Shoots. When the plan is shared, the shoot makes one card for the editor and everyone on the shoot is emailed.',
  'The editor makes the piece and puts the Drive or Dropbox link to the finished edit on the card, ticks the seven checks and submits it. The card goes to Quality check.',
  'The quality checker passes it to the client, or approves it without the client, or asks for changes with a note. The editor hears about changes and approvals, never about "with client".',
  'The client approves on their portal, or the account manager logs the client\'s answer. Logging an approval opens "Hand to": pick a scheduler, add notes, and the approved Drive folder goes with the card.',
  'The scheduler opens the card on Post approval, picks the files from the finished-edit link or the folder, uploads them, and they go through post approval. Then Schedule books them in, and Posts says what went out.',
  'A client who posts their own content: tick "Delivery only" on the shoot, on a card, or on the client. Those cards end at approval and never reach a scheduler.',
]

const EVERYONE = [
  'Every email the app sends opens the card on YOUR board: editors land on the Editor page, schedulers on Post approval, everyone else on the Editor page while a piece is being made and on Post approval once it is approved.',
  'Notifications in the sidebar is the same list: every approval, every "please change this", every @mention. Each opens the card.',
  'On any card, "What was said" is the team\'s notes. Type @ and the list offers the people on that card: the client\'s account managers, the quality checkers, the super admins, whoever holds it, whoever it was handed to. Each shows their job and email. The person you tag is emailed and sees "Waiting on you".',
  'Who can read team notes: a client sees only what is marked for them; account managers and super admins see everything; anyone else who can open the card sees every team note on it.',
  'Every move a card makes ends with a line in its history: "Told: Joy Quality (sent), Abby Ops (muted)" — who was emailed and what the mailer said. If someone says "I never got the email", open the card and read that line first.',
  'A refused move (a red message on the button) is not a move: nothing is sent. The card\'s history and the deployment log both say why.',
]

const ROLES = [
  {
    name: 'Super admin',
    job: 'Everything, for every client. Stands in for the quality checker when nobody wears that hat, and is the fallback for every email that has nobody else to go to.',
    pages: ['Every page: Overview, Clients, Shoots, Editor, Post approval, Schedule, Posts, Team, Leads, Audience, Reports, Notifications, Settings.'],
    looking: [
      'Team page: every person, their role (Scheduler, Editor, Quality checker, General, Account manager, Super admin), the Quality checker flag on another role, the Ops contact flag, and Active. A person marked inactive is offered nowhere and emailed nothing.',
      'Clients: every client, their managers, who schedules for them, connected channels, the portal link, "This client posts their own content", "This client signs off every post".',
      'Everything the account manager sees, for every client, plus Leads and Audience.',
    ],
    actions: [
      'Set roles and flags on the Team page. There must be at least one active Quality checker, or every quality-check email goes to the super admins instead.',
      'Add a client on Clients, run the brand scan on the client\'s page, set their managers and schedulers.',
      'Pass a card out of Quality check when the checker is away: the history says "in the reviewer\'s place" and the checker is emailed that it went past them.',
      'Delete things nobody else can: a shoot with its plan card, a brand scan\'s results.',
      'Act as a person (Team page, tech account only) to see exactly what they see.',
    ],
    emails: [
      'Everything an account manager gets, for every client.',
      'Every email that has no other recipient: a client with no manager, a team with no quality checker.',
    ],
    walkthrough: [
      'Open Team. Show the roles, the Quality checker flag, Active. Make one person the Quality checker.',
      'Open Clients, press Add client, fill it in, open its page, run the brand scan, set a manager and a scheduler, copy the portal link.',
      'Open the Overview and show the tiles: needs your decision, quality check, with clients, shoot plans late.',
      'Open a card in Quality check on the Editor page and press "Passed — send to client" to show the stand-in pass and the history line.',
    ],
    refusals: [],
  },
  {
    name: 'Account manager',
    job: 'Run your clients: plan the shoots, give out the work, check it, get it to the client, hand it to a scheduler.',
    pages: ['Overview, Clients, Shoots, Editor, Post approval, Schedule, Posts, Team, Reports, Notifications, Settings. Not Leads or Audience unless granted.'],
    looking: [
      'Overview: what is on you today — needs your decision, quality check, with clients, shoot plans late — and this month per client.',
      'Clients: your clients. Add client, the brand scan, managers, schedulers, channels, the portal link, the universal connect link (tick the platforms, copy or email it; the client signs in themselves).',
      'Shoots: one card per shoot in seven stages: Draft, Quality review, Shared with team, Confirmed, Reminder sent, Shoot day, Footage in. New shoot plan offers YOUR clients only.',
      'The shoot page: the nine-part plan, the canvas board (full screen with the client\'s comments beside it), who is on the shoot, "Delivery only" for a shoot whose pieces the client posts themselves, the client block (portal, PDF).',
      'Editor: every card being made for your clients: In Progress, Quality check, With client, For Handoff, Done. Opening a card gives you the manager\'s drawer: Pass, Ask for changes, approve, Hand to.',
      'Post approval: Draft, Quality check, With client, Ready to post, Booked in, Posted. New post here is for a posting job: a folder link handed to a scheduler.',
      'Schedule and Posts: the posting calendar per client, and what went out.',
    ],
    actions: [
      'New shoot plan: pick the client, name it, say what it is for, set the date. Fill the nine parts. Pick the editor and crew. Share with the team seven days out. Press "Send the plan for quality review" so the checker passes it. Tick aligned and confirmed, wait for every "I\'ve read the plan", press Go.',
      'New card on Editor: a piece or task for anyone. Pick client, title, what needs doing, a shoot if it is from one (the card carries only its own words, not the shoot\'s plan), files or a folder to work from, due date, who. The editor is emailed and must Acknowledge.',
      'On a card in Quality check: "Ask for changes" asks for your words and emails the editor. Passing is the checker\'s.',
      'On a card With client: when the client answers by phone, press "Log the client\'s approval". The Hand to dialog opens at once: pick the scheduler, write the notes, the approved Drive folder is prefilled. They are emailed.',
      'New post on Post approval: what the post is, notes for the scheduler, the folder they pick from, hand to a scheduler user.',
      'On a card: the folder to work from, the deliver-only tick, "Hand to…" once approved, "Rename or set due date".',
    ],
    emails: [
      'A card reaches Quality check for your client (with the checker and the Ops contact).',
      'The checker sends a card back, or passes it to the client, or approves it.',
      'The client approves or asks for changes on the portal (never the editor directly).',
      'An editor, scheduler, general user or quality checker makes a card for your client.',
      'A client comments on a board card (opens the board full screen on that card) or on a post.',
      'An editor flags a risk, or is blocked; the 12-hour and 24-hour escalations.',
    ],
    walkthrough: [
      'Clients: add a client, run the scan, set yourself as manager and one scheduler.',
      'Shoots: New shoot plan for that client, fill the nine parts, add an editor, share the plan, send it for quality review.',
      'Editor: New card for the same client with a Drive folder to work from, handed to the editor. Show that the card carries its own words only.',
      'Post approval: when a card is With client, press "Log the client\'s approval", pick the scheduler in the dialog, add a note. Show the scheduler\'s email link opens Post approval.',
      'Open the card\'s history and read the "Told:" line.',
    ],
    refusals: [
      '"No quality checker on the Team page yet" when sending a plan for review: set one on Team.',
      '"Only an approved or scheduled item can be handed to someone": a card still being made cannot be handed; wait for the pass.',
      '"Items need a booked shoot": a card on a shoot needs the shoot booked, or say where the footage is from.',
    ],
  },
  {
    name: 'General',
    job: 'Make work for any client, get it checked, and book it in when it has passed. No checking, no managing.',
    pages: ['Overview, Clients (not credentials), Shoots, Editor, Post approval, Schedule, Posts, Notifications, Settings.'],
    looking: [
      'Shoots for every client; New shoot plan offers every client.',
      'Editor: your own cards and the cards you made. Your own card opens the maker\'s drawer: the link box, the seven checks, submit.',
      'Post approval: cards handed to you and anything you uploaded; Ready to post with nobody named is yours to take.',
      'Schedule and Posts, as the scheduler has them.',
    ],
    actions: [
      'New card on Editor for yourself: pick any client. No acknowledgement is asked of you — you made it. The client\'s account managers are emailed.',
      'Put the Drive or Dropbox link to the finished edit on your card, tick the seven checks, submit for quality check.',
      'Hand a card on: once approved, "Hand to…" a scheduler.',
      'Book a passed piece in on Schedule.',
    ],
    emails: [
      'Your card comes back for changes, is approved, or goes out.',
      'A card is handed to you; someone tags you.',
    ],
    walkthrough: [
      'Editor: New card for any client, no shoot. Show no Acknowledge button appears.',
      'Paste a Drive link as the finished edit, tick the checks, submit.',
      'Post approval: take a card in Ready to post, open Schedule, book it.',
    ],
    refusals: ['"Paste the link to the finished edit before submitting" — the link is the work.'],
  },
  {
    name: 'Quality checker',
    job: 'Check every piece before it reaches the client or a scheduler, and pass or send back every shoot plan.',
    pages: ['Overview, Shoots, Editor, Post approval, Notifications, Settings.'],
    looking: [
      'Editor page, Quality check lane: every card waiting on you, whoever\'s client. The Overview\'s Quality check tile opens it. Cards you have passed or sent back stay on your desk afterwards.',
      'Opening a card gives you the manager\'s drawer: the Finished edit link above the folder, the editor\'s notes, "Passed — send to client", "Passed — approve without client", "Ask for changes".',
      'Shoots: a plan sent for review shows "Pass the plan" and "Send back" with a note.',
    ],
    actions: [
      'Open the finished edit link. Check spelling, dates, branding, quality, platform specs.',
      'Press "Passed — send to client" (or "approve without client" for a client who does not sign off). The card goes With client or Ready to post.',
      'Or press "Ask for changes": the dialog asks for your words; the editor is emailed them and the card goes back to In Progress with "What to change" on it.',
      'On a shoot page: "Pass the plan" or "Send back" with what to change.',
    ],
    emails: [
      'A card reaches Quality check (every submit comes straight to you).',
      'A plan is sent for quality review.',
      'A super admin passed a card in your place.',
    ],
    walkthrough: [
      'Overview: press the Quality check tile. It opens the Editor page\'s Quality check lane.',
      'Open a card, open the finished-edit link, press "Ask for changes", type a note. Show the editor\'s email and card.',
      'On the resubmitted card press "Passed — send to client". Show it stays on your desk under With client.',
      'Shoots: open a shoot in Quality review and pass the plan.',
    ],
    refusals: ['"Passing a plan is for the quality checker": your account needs the Quality checker role or flag, and Active.'],
  },
  {
    name: 'Editor',
    job: 'Make the pieces on your cards and hand each one on for the quality check. Your work is a link.',
    pages: ['Overview, Editor, Notifications, Settings.'],
    looking: [
      'Editor: In Progress, Quality check, With client, For Handoff, Done. Only your cards: handed to you, made by you, or tagged to you.',
      'The card: "Before you start" (on a card the shoot made: objective, deliverables, platform specs, deadline, shot list, script, notes; on any other card: what needs doing, deadline, notes), "Work from" (the footage folder), "Your finished edit" (ONE box: the Drive or Dropbox link — no files, no upload), "Your checks before you submit" (seven ticks), Handover ticks once approved, "Blocked?", What happened, What was said.',
      '"Open the plan and board" on a card from a shoot: the plan and the canvas, read only, no comments.',
      'A card handed to you says "New — press Acknowledge". A card you made yourself does not.',
    ],
    actions: [
      'Press Acknowledge on a card handed to you (same day).',
      'Make the piece, paste the Drive or Dropbox link to the finished edit, press Save.',
      'Tick the seven checks, press "Submit for quality check". After a revision, the same link is fine — press "Revisions done".',
      '"Something looks wrong — flag it" for a risk; "I\'m blocked" with what you need.',
      'New card for yourself when work arrives outside a shoot: pick the client, name it, say what needs doing, a shoot if it is from one.',
    ],
    emails: [
      'A card is handed to you; the shoot plan is shared with you; footage is in.',
      'Your card comes back with what to change; it is approved; it goes out.',
      'Someone tags you. Not: "with client" moves.',
    ],
    walkthrough: [
      'Open Editor, open a card handed to you, press Acknowledge.',
      'Read "Before you start", press "Open the plan and board", come back.',
      'Paste a Drive link in "Your finished edit", Save. Tick the seven checks. Submit.',
      'Show the card in Quality check with "With Joy". Show the email the checker got.',
      'Have the checker ask for changes; show the note on the card; press "Revisions done" with the same link.',
    ],
    refusals: [
      '"Add your Drive or Dropbox link first" (the button) and "Paste the link to the finished edit before submitting" (the server): put the link on.',
      '"Tick every check first".',
    ],
  },
  {
    name: 'Scheduler',
    job: 'Get the team\'s checked work onto the client\'s accounts, on time, from the link the manager handed you.',
    pages: ['Overview, Post approval, Schedule, Posts, Notifications, Settings.'],
    looking: [
      'Post approval: Draft, Quality check, With client, Ready to post, Booked in, Posted. You see the cards handed to you by name and anything you uploaded; Ready to post with nobody named can be taken by any scheduler.',
      'The card: Finished edit (the editor\'s link), Files to work from (the folder the manager handed over), the manager\'s notes, then the files box: Add files.',
      'Schedule: the week, per client, in the client\'s time zone; the rail of approved files; New post with Approved media, Upload, Google Drive; the post window with channels, kind, cover, caption, time.',
      'Posts: Scheduled, Did not post, Posted, channel by channel, with the reason and Send again.',
    ],
    actions: [
      'Open the handed card. Open the finished edit link or the folder, take the files, press Add files and upload them. They go through post approval; you are told when they pass.',
      'Schedule: pick the client, New post, Approved media, tick the channels, caption, time, Schedule. The card moves to Booked in, then Posted when every channel has it live.',
      'A red or amber icon on the Schedule bar: reconnect the channel there, or email the client the connect link.',
      'Posts: on Did not post, read why, fix it, Send again.',
    ],
    emails: [
      'A card is handed to you (opens Post approval on it), with the manager\'s notes and folder.',
      'Your uploaded files are approved, or changes are asked for.',
      'A post did not go out.',
    ],
    walkthrough: [
      'Open Post approval; open the card that was handed to you; open the finished edit link; press Add files and upload the pieces.',
      'Show the post approval coming back approved.',
      'Open Schedule, pick the client, New post, Approved media, book it. Show Booked in.',
      'Open Posts the next day: Posted, or Did not post with the reason.',
    ],
    refusals: [
      '"Upload the finished files first — the folder is what you work from, not the piece to check": a posting job needs the files uploaded, the folder is not the piece.',
      '"That file is too big" is gone: single files up to 5 GB upload; a big master goes to TikTok and YouTube by its address.',
    ],
  },
  {
    name: 'Client (portal)',
    job: 'See the plan, approve the work, comment, and connect their accounts — with no login.',
    pages: ['Their portal link, from the client\'s page. Their connect link for social accounts.'],
    looking: [
      'Their shoot plan first; then "Needs your review" — posts waiting on them; then what is approved and booked, then what is live with each channel\'s line.',
      'Nothing in production is on their page: a piece being made or checked appears only when it comes to them for a decision.',
      'The board link: the shoot\'s canvas, comments on a card only, nothing to edit.',
      'The connect page: Connect or Reconnect per network, in their own sign-in.',
    ],
    actions: [
      'Approve a post, or ask for changes with a note (the account manager is emailed, never the editor directly).',
      'Comment on a board card (the manager\'s email opens the board full screen on that card).',
      'Connect an account when asked, or reconnect when the link says so.',
    ],
    emails: ['A piece is ready to review. The connect link, and a reconnect request.'],
    walkthrough: [
      'Copy the portal link from the client\'s page and open it in a private window.',
      'Approve one post; ask for changes on another with a note; show where each lands for the manager.',
      'Open the board link, comment on a card, show the manager\'s full-screen board with the thread.',
    ],
    refusals: [],
  },
]

const MOVES = [
  ['Editor submits (In Progress → Quality check)', 'Quality checkers (or super admins if none), the Ops contact, the client\'s account managers'],
  ['Checker asks for changes', 'The editor, with the words; the account managers'],
  ['Checker passes to the client', 'The client\'s portal users, the account managers'],
  ['Checker approves without the client', 'The account managers, the editor, the schedulers it was handed to (or every scheduler if none)'],
  ['Client approves (portal, or logged by the manager)', 'The account managers, the editor, the schedulers it was handed to, the creator'],
  ['Client asks for changes', 'The account managers and the creator — never the editor directly; the manager sends the words back'],
  ['Card handed to a scheduler', 'That scheduler, with the notes and the folder'],
  ['Booked in / posted', 'The account managers and the editor; on posted, the schedulers too'],
  ['A card made by a non-manager', 'The client\'s account managers'],
  ['Someone tagged in a note', 'That person, once, with the words'],
]

/* ── the rendering ───────────────────────────────────────────────────────── */

const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: 'MD Media — the role-by-role tutorial guide' } })
doc.pipe(createWriteStream(OUT))
const W = doc.page.width - 112

const H1 = (t) => { doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(20).fillColor('#111').text(t, { width: W }); doc.moveDown(0.4) }
const H2 = (t) => { doc.moveDown(0.5); doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(t, { width: W }); doc.moveDown(0.2) }
const P = (t, opts = {}) => { doc.font('Helvetica').fontSize(10.5).fillColor('#222').text(t, { width: W, lineGap: 2, ...opts }); doc.moveDown(0.25) }
const bullets = (items, numbered = false) => {
  items.forEach((t, i) => {
    const mark = numbered ? `${i + 1}.` : '•'
    const y = doc.y
    doc.font('Helvetica').fontSize(10.5).fillColor('#222').text(mark, 56, y, { width: 18, continued: false })
    doc.text(t, 76, y, { width: W - 20, lineGap: 2 })
    doc.moveDown(0.2)
  })
  doc.x = 56
}
const ensure = (h) => { if (doc.y + h > doc.page.height - 56) doc.addPage() }

// cover
doc.font('Helvetica-Bold').fontSize(28).fillColor('#111').text('MD Media', { width: W })
doc.font('Helvetica-Bold').fontSize(18).text('The role-by-role tutorial guide', { width: W })
doc.moveDown(0.3)
doc.font('Helvetica').fontSize(11).fillColor('#555').text('What each role sees, what they press, what happens next, and what to show them. Written from the app as it is on 14 September 2026.', { width: W })
doc.moveDown(1)

H1('How a piece of work moves')
bullets(FLOW, true)

H1('True for everyone')
bullets(EVERYONE)

H1('Who is told, on every move')
MOVES.forEach(([move, who]) => {
  ensure(40)
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111').text(move, { width: W })
  doc.font('Helvetica').fontSize(10.5).fillColor('#222').text(who, { width: W, lineGap: 2 })
  doc.moveDown(0.3)
})

for (const r of ROLES) {
  doc.addPage()
  H1(r.name)
  P(r.job)
  H2('Pages they have'); bullets(r.pages)
  H2('What they are looking at'); bullets(r.looking)
  H2('What they do'); bullets(r.actions)
  H2('Emails they get'); bullets(r.emails)
  H2('Tutorial walkthrough — what to show, in order'); bullets(r.walkthrough, true)
  if (r.refusals.length) { H2('Refusals they may hit, and what they mean'); bullets(r.refusals) }
}

doc.addPage()
H1('Demo data to prepare before a tutorial')
bullets([
  'A test client (name it ZZ TEST) with one account manager, one scheduler, and the portal link copied.',
  'One team member per role, all Active: an account manager, a general user, a quality checker, an editor, a scheduler. Give the checker the Quality checker role, not only the flag.',
  'A Drive folder with two or three finished clips and one still, and a second folder for "files to work from".',
  'A shoot on ZZ TEST with the nine parts filled, shared with the team, and its plan sent for quality review.',
  'A card the editor made themselves, and a card the manager made and handed to the editor, so both drawers can be shown.',
  'A post already Booked in on Schedule, and one in Did not post, so Posts has something to say.',
])

doc.end()
console.log('wrote', OUT)
