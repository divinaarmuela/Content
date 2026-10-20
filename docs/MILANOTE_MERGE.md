# Milanote → Boards: the merge

The owner, 20 Oct 2026, for Renée: **"she needs all of it to be there and exactly the same"**, editable, with
Milanote's features and its look. Milanote is read, never changed, and stays until Renée signs off.

## What is in Milanote (read 20 Oct 2026, every board, read only)

211 boards, 5,080 items. Snapshot: `milanote-snapshot.json` (Downloads, 10.4 MB) — every element as Milanote's
own API returns it. Images download from `content.image.original` without a login (checked: 200, full size).

| Milanote element | Count | Notes |
|---|---|---|
| CARD (note) | 1,552 | ProseMirror-style JSON (`type: doc`), bold/italic/colour marks, lists; 624 are clones |
| IMAGE | 1,199 | `image.original/large/regular/thumb`, `caption` (445), sizes |
| LINK | 595 | `link.url`, `title`, `provider`, `image`, `caption`; Instagram/TikTok embeds |
| TASK / TASK_LIST | 508 / 96 | `isComplete`; due/assignee used once in all of Milanote |
| COLUMN | 395 | `title`, `width`, `collapsed`, `color`; children in its INBOX section |
| LINE | 304 | `start`/`end` (point, or snapped to an element), `control` (curve), `lineLabel`, styles, `color` |
| BOARD | 211 | `title`, `icon`, `color`/`secondaryColor`; nests up to 4 deep |
| DOCUMENT | 87 | `title` + long rich text; a tile on the canvas showing the word count |
| COLOR_SWATCH | 77 | `color` hex, `caption`, `showColorValue` |
| TABLE | 31 | `tableContent.data` — cells hold draft-js strings, header styling |
| FILE | 9 | `file` + `attachmentId` |
| COMMENT_THREAD | 7 | comments on a card |
| ALIAS | 6 | a shortcut to a board elsewhere |
| ANNOTATION | 1 | a drawing — skipped |

Kinds of board (by title and content): 51 shoot/brief, 39 inspo/moodboard, 46 strategy/concepts, 16 monthly
plans, 35 folders/other, 24 empty. Last Milanote edit: 25 May 2026.

## Where it goes

**The Boards page the team already uses (`team_boards`, sidebar "Boards")**, on the same canvas as the shoot brief
(`CanvasCard`, `batch-brief-core.ts`) — so imported briefs and boards look and behave like the live ones, and keep
the quality check and the client-portal share that Boards already has. (The older nested `boards` / `board_items`
feature is unused — 5 empty boards — and is not the target.)

- The tree is kept exactly: Home → MD Media → each client → months, shoots, moodboards.
- Each board carries a **type**: Shoot / brief, Inspo / moodboard, Strategy / concepts, Monthly plan, Other — set
  from the audit, changeable; **the Boards page filters by type** (and by client).
- Shoot-brief boards are also listed on the client's **Shoots** page as "Past briefs (from Milanote)" — the same
  board, never a copy.
- A Milanote client with no client record here gets one, as a **past client** (no portal, email or Drive).
- Every board stays **editable**.

## Look (from Milanote, 20 Oct 2026)

Dotted grey canvas; white cards with a soft shadow; serif titles on columns and board names (`MGMT Shoot Brief`);
a column is a white panel with a centred serif title and a grey count ("2 cards, 1 document"), its cards stacked
inside; board tiles are a coloured square icon + name + "8 boards, 2 cards"; notes are rich text (bold, italic,
bullets, small grey type); images sit free, overlapping, with a caption strip ("From Pinterest"); colour swatches
are a block with the hex in its corner and a name under it; task lists are ticks with done ones greyed; tables
have a grey header row; documents are a tile with an icon, a title and "235 words"; lines are thin and dark, some
curved, some labelled; Instagram/TikTok links show the post with its caption as an orange link.

## How it is stored (the canvas's own shape)

A team board is ONE `team_boards` row whose `canvas_cards` holds every card of its whole tree — a child board is a
`board` tile, and its contents are the cards whose `parent` is that tile (`batch-brief-core.ts`). So:

- **one team board per Milanote client** (Basfoods, Chantal Cutter …), its whole tree inside it; the card cap
  (`CANVAS_MAX_CARDS`, 600) rises to fit the largest (Chantal Cutter 621, Hydrawearable 607);
- **one top-level "MD Media" team board** rebuilds Milanote's home — The agency, Brand, Team, the Client Accounts
  column — its client tiles are **board links** (Milanote's ALIAS) that open each client's own team board;
- every card keeps its Milanote id (`mn`), so the import re-runs without doubling anything;
- positions are written as Milanote has them (the canvas already allows any position within ±20,000), never
  snapped; a column's cards keep Milanote's order inside it.

New card fields (stage 1): `hex` (exact colour), `html` (rich text, an allowlist), `col` + `ord` (a card inside a
column, and its place), `rows` (a table), `line` (a line's points, curve, label, ends, weight, colour — joined to
cards or free), `file` (url, name, size, type), `target` (a board link's team board), `mn` (the Milanote id).
New kinds: `column`, `document`, `table`, `swatch`, `file`, `boardlink`. A Milanote task list is the existing
`todo` card (its title in `name`, its tasks in `items`).

## Stages

1. **The canvas learns Milanote**: new card kinds — column (holds cards), document, table, colour swatch, task list,
   file, line (curve, label, ends) — plus captions, exact hex colours, exact positions and sizes (no snapping on
   import, any position), rich text (italic, colour, lists, links). Pure rules in `batch-brief-core.ts`, tested.
2. **Boards in boards**: a board card opens a child board; breadcrumbs; the type tag and the filter.
3. **The look**: the drawing of each kind matched to the screenshots above.
4. **The import** (`scripts/import-milanote.mjs`): reads the snapshot, copies every image and file into R2, creates
   missing clients, writes every board and card with its exact place. Dry run first — a count per board — then
   writes; idempotent on the Milanote id.
5. **The check**: every board's counts against Milanote's; side by side on screen, Renée's boards first.
