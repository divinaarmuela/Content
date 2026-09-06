# Three pages reset — foundation, and what the page agents call

**Date:** 6 September 2026 · **Branch:** `three-pages-reset` · **Spec:** `docs/superpowers/specs/2026-09-06-three-pages-reset-design.md`

This is the model and the rules. No page, portal or canvas was built. Everything below
is pure-first and tested; the page agents draw screens on top of it and call the routes.

## What exists now

### 1. The five columns — `app/lib/board-core.ts` (pure, browser-safe)

| export | use it for |
|---|---|
| `BOARD_COLUMNS` | the lanes, left to right: `key`, `label` (Draft, Internal check, With client, Ready to post, Posted), one-line `meaning`, `statuses` |
| `columnOf(status)` | which lane a card is in |
| `statusesIn(column)` / `boardColumn(key)` | the reverse lookups |
| `columnsForRole(role)` | editor → Draft, Internal check, With client · scheduler → Ready to post, Posted · AM / super admin → all five · client → With client (the portal) |
| `groupByColumn(cards, columns?)` | cards bucketed into lanes, empty lanes included, input order kept |
| `canMoveTo(card, column, hats)` | **the drag rule.** `hats` = `actingRoles(viewer, card)` from `workflow-core`. Returns `{ ok, to, label }` — the FIRST status in the lane the person may legally reach — or `{ ok: false, reason }` in the machine's own plain sentence. Reuses `availableTransitionsAs`; there is no second rule set. A same-lane drop is refused ("Already in Internal check") — moves within a lane stay buttons. |
| `reachableColumns(card, hats)` | which lanes to highlight while dragging |

A drop calls the EXISTING transition route with `canMoveTo(...).to`:
`POST /api/production/items/[id]/transition { to }`. Snap back with `reason` if refused.

### 2. A card carries a link — `app/lib/card-link-core.ts` + `PUT/DELETE /api/production/items/[id]/link`

- Columns on `content_items` (ghost, nullable): `link_url`, `link_kind` (`'drive' | 'dropbox' | 'other'`).
- `linkKindOf(url)` → `{ ok, kind, label, url }` or `{ ok: false, reason }`. https only; Drive and Dropbox by host; labels "Google Drive", "Dropbox", "Link". `linkLabel(kind)`, `versionWord(n)` → "version 3".
- `PUT …/link { url }` — any team role who may edit the card (`canEditItemFields`: the holder, whoever holds its scheduling, or a manager). One conditional write (`claim`): a first link is version 1 (or keeps the card's uploaded-version number), a replacement bumps `current_version_number` and writes `workflow_activity` "Link updated to version N". Same link again → `{ already: true }`. Response: `{ ok, version, kind, label, url }`.
- `DELETE …/link` clears the link; the version number stays.
- Never touches Google Drive (trap 13).

### 3. Free-text kinds — `POST /api/production/work-kinds/adopt { name }`

- Any team role. Returns `{ kind, created }` (201 when new, 200 when adopted; `revived: true` when an archived kind was typed again).
- Pure helpers in `work-kinds-core.ts`: `normaliseKindName`, `kindSlugOf` (a–z 0–9 `_`, ≤ 40, never empty, never `shoot_brief`), `findKindByName`.
- "Odd Job" and "odd job" are one row. Two racing requests create one row — the unique slug decides, the loser adopts the winner. Wire the kind box as a combobox: list `GET /api/production/work-kinds?active=1`, and on a name that is not in the list call `adopt` and use `kind.id` as `work_kind_id`.

### 4. Client comments reach the person who must act

- `comment-access-core.ts`: `canReadClientComments(role)` (AM + super admin only), `clientCommentsFor(role, comments)`.
- `GET /api/production/items/[id]/client-comments` → `{ comments: [{ id, created_at, body, author_name, resolved }], change_note, change_note_at, status }`. **403 for editors and schedulers** — draw nothing for them, do not call it.
- `POST /api/production/items/[id]/send-back { note }` — AM / super admin. Moves the card to Internal check through the ordinary edges (from With client: "Log the client's changes" then "Send for revision"; from Internal check: "Ask for changes"; already being revised: no move), writes `change_note` / `change_note_by` / `change_note_at` on the card and an internal comment tagged to the assignee, and notifies the ASSIGNEE by bell and email in the manager's words (one `notify()`, `EMAIL_TEST_ONLY` honoured inside it). Response: `{ ok, status, column, steps, notified, change_note }`. 400 without words, 403 when the rules refuse (the reason is the sentence to show), 409 on a stale card.
- On the assignee's card, show `change_note` (from the item row) while the card is in Internal check — that is "what to change", in the manager's words.

### 5. Page access by role — `page-access-core.ts`

- editor → Editor · scheduler → Scheduler + Schedule (`SCHEDULE_PAGE = '/dashboard/social/schedule'`) · account_manager → their clients' pages (all but Leads/Audience) · super_admin → everything incl. Leads. Personal three (Overview, Notifications, Settings) for every team role.
- `socialParentOf(href)`; `canSeePage` falls back from a Social child to Social, so a grant of Social opens all of it and hiding Social hides all of it; the scheduler holds Schedule on its own. `Shell.resolveNav` draws Schedule un-nested when Social itself is not visible; `layout.tsx` checks a Social child against itself.
- Server routes keep their own gates; this is what the nav draws.

## What the page agents build (not here)

- **Production** (AM/super): list stays; a Board view using `columnsForRole`, `groupByColumn`, `canMoveTo` + the transition route; remember the choice. Card carries `link_url` chip (`linkLabel`) and `versionWord(current_version_number)`. Per-card approval control from `presentTransitions`. "Send back for changes" → `client-comments` to pre-fill, `send-back` to act.
- **Editor**: only cards assigned to them, only their three lanes; "hand on for checking" on the card; `change_note` shown on a card that came back.
- **Scheduler**: Ready to post + Posted, the Schedule link; "book it in" on the card.
- **Portal**: every With-client card with its link; one-tap Approve (existing portal act route); "Ask for a change" secondary, no note required. Client colour and logo; `app/dashboard/ui/*` components.
- **Canvas**: the Milanote-style free canvas with sub-pages behind a card — separate model, not started.

## Tests that pin this

`tests/board-core.test.ts`, `card-link-core.test.ts`, `item-link-route.test.ts`, `work-kinds-adopt-route.test.ts`, `client-comments-route.test.ts`, `send-back-route.test.ts`, `page-access-core.test.ts`, `shell-nav.test.ts`, `db-types.test.ts`.
