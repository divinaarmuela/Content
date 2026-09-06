# Three pages reset — link-first cards, five columns, one-tap portal

**Date:** 6 September 2026 · **Status:** owner-directed, building
**Owner's words:** "production, editor and scheduler approve pages … for now lets make it a
drive / dropbox approach … all pages should have the columns in draft, client review etc …
everything once sent to client must be shown on portal with the links … no more 2 reel 2
graphic and creating sub card in the card no … its either drive link or dropbox and the
status keeps them on track the columns … client portal needs a redesign … nothing can be
approve with note and confusing and one click on each card like swipe from right …
my team is currently confused on how to use it"

## The problem being fixed

The team cannot work the current model. A piece of work is a `content_item` that carries
`asset_versions`, each version carrying `slides`, and the pages render that nesting. To
brief two reels and two graphics somebody makes a card and then makes sub-cards inside it.
Nobody can see, at a glance, what state anything is in.

## The model after this change

**A card is one deliverable.** One thing a person makes, for one client, with one link to
where it lives (Google Drive or Dropbox). Cards are never nested. Four reels is four cards.

| field | notes |
|---|---|
| client | as today |
| title | short, plain |
| kind | FREE TEXT. Typing a new one adds it for next time (`work_kinds`) |
| link | a Drive or Dropbox URL, pasted. Detected and labelled; no account, no integration |
| status | one of the nine existing statuses, shown in five columns |
| version | increments when the link is replaced; shown as "version 3", never as sub-cards |
| owner / due | as today |

Media uploads are NOT removed — the Schedule page's upload-and-post path stays exactly as
it is. This is about how WORK is briefed and tracked, not how a post is made.

## Five columns, on all three pages

| column | statuses underneath |
|---|---|
| Draft | `draft_uploaded` |
| Internal check | `internal_review`, `revision_required`, `revision_complete` |
| With client | `client_review`, `client_changes_requested` |
| Ready to post | `approved_for_scheduling` |
| Posted | `scheduled`, `published` |

The statuses do not change, so every rule, notification and approval already written keeps
working. The columns are a presentation of them, defined once in a pure module and used by
Production, Editor, Scheduler and the portal.

## The three pages

Same board, different lens:

- **Production** (account managers, super admins): every client they hold. List view stays;
  **Board** is a view they can switch to, and the choice is remembered.
- **Editor**: only cards assigned to them, only the columns that mean anything to them
  (Draft → Internal check → With client). Nothing else in the nav.
- **Scheduler**: cards that are Ready to post or Posted, and the Schedule page.

Drag a card between columns to move it, where the person's role allows that move. A move
the rules refuse snaps back with the reason in plain words.

## Who sees what

| role | pages |
|---|---|
| editor | Editor only |
| scheduler | Scheduler, Schedule |
| account_manager | their clients: Production, Editor, Scheduler, Schedule, portal-facing screens |
| super_admin | everything, plus Leads |

Enforced server-side, as today; the nav simply stops showing what a role cannot open.

## The client portal, rebuilt

- Every card that reaches **With client** appears in the portal, with its link, so the client
  opens the work where it lives.
- **One tap approves.** The Approve control is on the card. On a phone, swiping the card
  from the right approves it.
- **No note is required, ever.** "Ask for a change" is the secondary action and opens a
  single box.
- No second screen, no status jargon, no more than one sentence per card.

## The client's words go to the person who has to act on them

Owner: "make sure AM can see the client comments only and then if needs changes can send
back to the person assigned, send them what needs changing".

- A client's comment on a card is shown to the **account manager**, not broadcast to the
  whole team — the client is talking to their manager, not to the room.
- The card then carries one action for the manager: **Send back for changes**, which asks
  what needs changing (the client's own words are pre-filled and editable), and sends it to
  **the person the card is assigned to**, by bell and email, with the card moving to
  Internal check.
- The assignee sees exactly what to change on their own card, in the manager's words. They
  never have to read the client's thread to work out what was meant.
- Editors and schedulers do not see client comments at all.

## The board is a Milanote-style canvas

Owner: "milanote board feature needs to be exactly like milanote, can create subpages by
adding a button", and a screenshot of their real Milanote board ("Golf Day") to work from.

What that board actually contains, and therefore what we build:

- **A free canvas.** Items sit where they are put, at any position, not only in columns.
  Pan and zoom; position is saved per item.
- **Item types**, each a card on the canvas:
  - **Note** — rich text: a heading, bold, bullet lists, and a highlight (their board uses a
    blue highlight to mark a decision, e.g. a location name). This is the workhorse.
  - **Image** — dropped or pasted, shown at a chosen size.
  - **Link** — a Drive or Dropbox URL, shown with its label.
  - **Board** — a NESTED board, shown as a coloured icon tile with its name and a count
    underneath ("Models · 39 cards", "Concepts · 3 boards"). One button on the canvas makes
    one, and opening it is the sub-page. Boards nest to any depth.
  - **Heading / banner** — a full-width coloured title strip across the canvas
    ("SHOOT CONCEPTS"), for dividing a board into areas.
  - **Column** — a titled stack items can be dropped into ("Shoot Day 1 (Day time)"), which
    is how the five status columns are drawn on the work board: a column is just an
    arrangement of the same canvas.
- **A card shows a count of what is inside it** when it holds other items.
- **Comment on any single item**, exactly as their board does — the screenshot shows a
  "Comment only" control pinned to an image. A comment belongs to that item, carries who
  left it and when, and never becomes one long thread for the whole board.
- **Breadcrumbs** back up the nesting, since boards go several deep.
- **Every item can be coloured and sized by the person who put it there.** A heading strip
  takes a colour (their board uses a soft olive for "SHOOT CONCEPTS"); a board tile takes a
  colour and an icon; a note takes a colour. Colours come from the restyle's palette, offered
  as a small swatch row, never a free colour picker, so a board cannot be made ugly or
  unreadable in dark mode.
- **Length and width are the person's choice.** A heading spans the width it is dragged to;
  a note, image or column is resized by its corner and remembers that size. Sensible
  minimums so nothing collapses to nothing, and text wraps rather than clipping.


Built with the restyle's cards, chips and tone map — the canvas is our look, not Milanote's.

## The look

Owner: "make sure the board are using the current renewed layout", "yea client portal must
be nice".

- Every one of these screens is built from `app/dashboard/ui/*` — the Shell, PageTitle,
  cards, chips and tone map from the September restyle. No new visual language, no
  component invented beside the ones that exist.
- The board's cards are the restyle's work cards: the tinted client colour, the status
  chip, one line of text, 44px controls. A column is a lane, not a boxed panel.
- **The client portal gets the same care as the dashboard, in the client's own brand.**
  It carries the client's colour and logo, one card per piece, the link, and the tap to
  approve. It should look like something the agency made for them, not an internal tool
  with the chrome removed. Same light and dark handling as the dashboard.


## Approving happens on the card, on the page you are already on

Owner: "production, editor and schedular approve pages".

Each of the three pages carries the approval that belongs to its stage, on the card, with
no second screen and no navigation:

- **Editor**: hand a card on for checking when it is ready.
- **Production** (account manager): approve a card's work, send it to the client, or send it
  back for changes with what needs changing.
- **Scheduler**: take a Ready-to-post card and book it in.

One control per card, labelled with what it does, using the transitions that already exist.
A move the rules refuse says why in plain words.

## Each role's Overview shows their own work

Owner: "they can have their overview page shown nicely whats there and all".

The Overview page is the first thing each person sees, and it answers "what is on me today"
in one screen, in the restyle's cards, with no jargon:

- **Editor**: what is assigned to them, what is due, what came back for changes.
- **Scheduler**: what is ready to post, what goes out today, what is waiting on an account.
- **Account manager**: their clients, what needs their decision now, what is with clients.
- **Super admin**: the agency at a glance, plus their Leads.

Every tile is a link into the card or column it counts. Counts are never shown without a
way to act on them.


## The portal opens on the board

Owner: "also by default make the board show on the portal".

- The client's portal opens on a **board of their work**, in their own brand: the same five
  columns, read as a client would read them, so they can see at a glance what is being made,
  what is with them, and what has gone out.
- The card they can act on carries the link and the tap to approve. Cards in other columns
  are there to be seen, not touched.
- No status jargon on the client's side: the columns are named for what they mean to them.


## A comment belongs to the thing it is about

Owner: "ensure that they can leave comments on the board on which part of the board".

- A client can comment **on a specific card**, not in one long thread for the whole project.
  The comment is pinned to that card and shown on it, so nobody has to work out what
  "the second one" referred to.
- On a **sub-page** (the Milanote-style canvas behind a card), a comment can be left on a
  specific item on that canvas — a note, an image, a link — again pinned where it was left.
- The comment carries who left it and when, and the account manager sees it on the card
  (see "The client's words go to the person who has to act on them"). Editors and schedulers
  still do not see client comments.


## Not in this change

- The Schedule page and its posting rules (built and live).
- Google Drive stays READ ONLY (CLAUDE.md trap 13). A pasted link is a link, not a write.
- Existing cards keep their versions and slides; the pages stop nesting them.
