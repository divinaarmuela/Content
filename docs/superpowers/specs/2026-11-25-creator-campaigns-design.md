# Creator campaigns — design (25 Nov 2026)

Status: DRAFT, waiting for the owner's approval. Nothing is built.

## Why

The owner looked at another agency's client portal (a creator lunch for a
fragrance brand: a shortlist of creators the brand approves or passes on, a
seat count, a confirmed list) and asked for the same kind of thing inside the
MD Media dashboard: "a page where we can build this portal", where "super
admins can create for any client" and account managers see and create theirs
and can join others.

## Version one (approved scope: pieces 1 and 2)

1. **The team's page** — `/dashboard/creators`, "Creator campaigns".
2. **The client's view** — a new section of the client's existing portal link.

Creators are typed in by hand in version one.

### Not in version one (agreed with the owner)

- The public invite page where creators register themselves.
- Auto-filling a creator's profile from ScrapeCreators (needs a paid key).
- Any email or message to a creator. The app never contacts a creator in
  version one; the team does that themselves and records the answer.

### What would make it a failure

- An account manager seeing or changing a campaign of a client that is not
  theirs and that they were not added to.
- A client seeing another client's campaign, or a creator the team has not
  yet put in front of them.
- A copy of the other agency's look, wording or images. Same idea, MD
  Media's own dashboard look and plain words.

## Who may do what

| | Super admin | Account manager | Everyone else |
|---|---|---|---|
| See | every campaign | campaigns of their own clients, plus any they were added to or made | nothing (page can be granted per person like any other) |
| Create | for any client | for their own clients only | no |
| Edit, add creators, show to client | any | the ones they can see | no |
| Add or remove team members on a campaign | yes | on the ones they can see | no |
| Delete a campaign | yes | only one they made, and only while it is a draft | no |

"Their own clients" is the existing `team_user_clients` link. Every rule is
checked again in the API route; the page only hides buttons.

**My call, to confirm:** "AM can join" is built as *being added* by a super
admin or by anyone already on the campaign. An AM cannot browse other
clients' campaigns and add themselves, because that would mean showing them
campaigns of clients that are not theirs.

## The team's page

**List** (`/dashboard/creators`): one card per campaign — client, title,
date, "8 of 10 confirmed", how many are waiting on the client, status chip
(Draft · Live · Closed). Filter by client and status. Super admins get an
"All clients" view; an AM's list is already only theirs. Button: New
campaign.

**One campaign** (`/dashboard/creators/[id]`), three tabs:

- **Details** — client, title, kind (event or content campaign), date and
  time, place, number of seats, the date the list closes, what each creator
  delivers (a short list: "3+ Instagram Stories on the day", "1 recap Reel
  within 7 days"), usage terms (one line), team members on it.
- **Creators** — the working list. Add a creator: name, photo (upload to R2
  like other dashboard uploads), Instagram / TikTok handles and follower
  counts, "why this creator" note, gifted or paid (with rate), up to six
  sample post links. Each creator sits in one stage:

  `Idea → With client → Approved | Passed → Invited → Confirmed | Declined`

  The team moves a creator to *With client* (one or several at once); only
  then does the client see them. The client's Approve / Not this one moves
  them on. *Invited*, *Confirmed* and *Declined* are set by the team by hand.
- **Client view** — a preview of exactly what the client sees, the portal
  link to copy, and a switch: Show to client / Hide from client.

A creator typed in once is kept in an agency-wide list, so the next
campaign can pick them instead of retyping. Picking copies the profile onto
the campaign; the "why" note and the terms are per campaign.

## The client's view

Lives in the existing portal (`/portal/[token]/…`), so the client uses the
link they already have and nothing new is public. A campaign appears only
when it is Live and switched to Show.

- **Overview** — title, date, place; "8 of 10 seats confirmed · 1 waiting on
  their yes · 1 open"; a next-step line ("1 new creator to look at"); the
  four dates (choosing, list closes, the day, content due); what each
  creator delivers.
- **Shortlist** — creators at *With client*: photo, name, follower counts,
  the why note, sample posts, gifted/paid. Buttons: **Approve**, **Not this
  one**, **Add a note**. A passed creator stays in a "Passed on" list with
  "Change my mind" until the list closes.
- **Confirmed** — approved, invited and confirmed creators with their state
  in plain words ("Place confirmed", "Waiting on Lydia").

A client's decision notifies the campaign's team (bell and email, through
the existing `notify`, which already honours `EMAIL_TEST_ONLY` and the
test-client guard). After the closing date the buttons are gone and the
page says the list is closed.

## Data (RTDB, ghost tables in `scripts/gen-db-types.mjs`)

- `creator_campaigns` — id, client_id, title, kind, starts_at, ends_at,
  place, seats, closes_on, deliverables[], usage_terms, status
  (draft/live/closed), client_visible, member_ids[], created_by, created_at,
  updated_at, rev.
- `creators` — id, name, photo_url, instagram, instagram_followers, tiktok,
  tiktok_followers, bio, created_by, created_at, updated_at.
- `campaign_creators` — id (`{campaign_id}__{creator_id}`), campaign_id,
  client_id, creator_id, a copy of the profile fields, why, terms
  (gifted/paid), rate, samples[], stage, client_note, decided_at,
  decided_by, rev.
- `campaign_creator_events` — append-only history: who moved which creator
  from which stage to which, when, with what note.

## How it is built (my calls, following the codebase's rules)

- Pure rules in `app/lib/creator-campaign-core.ts` (who may see / create /
  edit; the stage machine; the seat count; the overview's words), fully unit
  tested. Thin server wrappers do the database work.
- Stage moves and client decisions use `rev` with `compareAndSet` — never
  check-then-write. Two people pressing at once: one wins, the other is told.
- Team routes under `/api/creators/**`, each guarded by role AND by the
  per-campaign rule. Client routes under `/api/portal/creators/**`,
  authorised by the portal token and scoped to that token's client.
- New protected paths added to the `middleware.ts` allowlist.
- Page added to the sidebar (under Clients) and to `GRANTABLE_PAGES`;
  default for super admins and account managers.
- Shared look from `app/dashboard/ui` (Shell, PageTitle, cards, chips).
  Desktop-only CSS in a min-width query; checked at 390px and desktop.

## Approaches considered

1. **A new dashboard page plus a section in the existing client portal**
   (chosen). Reuses the client link, the roles, notify and the look. The
   client has one place for everything.
2. A separate stand-alone portal site per campaign, like the one we looked
   at. Rejected: a second login/link model and a second look to maintain,
   and clients would hold two links.
3. Model a campaign as a Board or a Shoot. Rejected: neither has per-item
   client approval with seats and stages, and bending them would break pages
   the team already relies on.

## Proof before it is called done

- `npm test`, `npx tsc --noEmit`, `npm run build` all pass.
- Role walk on the ZZ TEST client only, with `.invalid` test accounts:
  super admin, an AM on the client, an AM not on the client (must see
  nothing), an AM added to the campaign, an editor (no page).
- Client walk through the ZZ TEST portal link: approve, pass, change mind,
  note, closed list.
- Every page rendered at 390px and desktop and looked at.
- Nothing is pushed to `main` (a push is a production deploy) until the
  owner says so.

## Later (pieces 3 and 4, separate designs)

- Public invite page with a register-interest form.
- ScrapeCreators lookup to fill a creator's profile and recent posts.
