# Creator Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dashboard page where super admins (all clients) and account managers (their clients, plus campaigns they were added to) build a creator campaign, and a client-facing view under the client's portal token where the client approves or passes on shortlisted creators.

**Architecture:** Pure rules in `app/lib/creator-campaign-core.ts` (who may see/create/edit, the creator stage machine, seat counts, the client's overview). Thin server wrappers in `app/lib/creator-campaigns.ts` over `lib/db.ts` (RTDB REST), with every stage move guarded by `rev` + `compareAndSet`. Team routes under `/api/creators/**` (Clerk + role + per-campaign rule); client routes under `/api/portal/creators/**` (portal token → client, via `portalOwnerByToken`).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v3.4, shadcn classic (Radix), Firebase RTDB via `lib/db.ts`, Clerk 7, vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-creator-campaigns-design.md`

## Global Constraints

- Tailwind v3 only; shadcn classic only; dashboard styles stay under `.dbx`; dialogs use `bg-popover`.
- No `firebase-admin`; never write outside `/mdm`; never check-then-write (`compareAndSet` / `claim`).
- New tables are GHOST TABLES in `scripts/gen-db-types.mjs`; run `node scripts/gen-db-types.mjs` after editing.
- Route protection is an allowlist in `middleware.ts`: add `/api/creators(.*)`. `/api/portal/**` stays public (the token is the authority).
- Authorization is enforced in every route; hiding a button is not security.
- The app never contacts a creator in version one. Client decisions notify the team through `notify` (honours `EMAIL_TEST_ONLY`).
- Words: plain, MD Media's own. No copy, look or images from the other agency's portal. The vocabulary sweep bans the word "brief" on `app/dashboard/(editor|scheduler|production)` only; this page lives at `app/dashboard/creators`.
- Phone first: desktop-only CSS inside a min-width query; every page looked at at 390px and desktop.
- Live testing only on the ZZ TEST client with `.invalid` accounts. Nothing is pushed to `main` without the owner's word.
- Done means `npm test`, `npx tsc --noEmit` and `npm run build` all pass (one known failure on main: `tests/one-portal-forms.test.ts:91`).

## Review Focus

- A campaign whose client the AM was removed from after they made it: they must lose it unless they are in `member_ids`.
- Two people (or the client and the team) moving the same creator at once: one wins, the other gets a refusal with the fresh row, nothing is half-applied.
- The client's link opened after `closes_on`, or after the team switched the campaign to hidden: no decision is accepted; the page says why.
- A creator approved when every seat is already confirmed: allowed (approval is not a seat), but the overview must never show more confirmed than seats without saying so.
- A portal token for client A sent with a campaign id of client B: 404, and nothing about B leaks.

Each has a test in the task that owns the code (Tasks 1, 3, 5).

---

### Task 1: The rules (pure core)

**Files:**
- Create: `app/lib/creator-campaign-core.ts`
- Test: `tests/creator-campaign-core.test.ts`

**Interfaces — Produces:**

```ts
export const CREATOR_STAGES = ['idea', 'with_client', 'approved', 'passed', 'invited', 'confirmed', 'declined'] as const
export type CreatorStage = (typeof CREATOR_STAGES)[number]
export type CampaignStatus = 'draft' | 'live' | 'closed'
export type Campaign = {
  id: string; client_id: string; title: string; kind: 'event' | 'content'
  starts_at: string | null; ends_at: string | null; place: string | null
  seats: number | null; closes_on: string | null            // YYYY-MM-DD
  deliverables: string[]; usage_terms: string | null
  status: CampaignStatus; client_visible: boolean
  member_ids: string[]; created_by: string | null
  created_at: string; updated_at: string; rev: number
}
export type CampaignCreator = {
  id: string; campaign_id: string; client_id: string; creator_id: string
  name: string; photo_url: string | null
  instagram: string | null; instagram_followers: number | null
  tiktok: string | null; tiktok_followers: number | null
  why: string | null; terms: 'gifted' | 'paid'; rate: string | null; samples: string[]
  stage: CreatorStage; client_note: string | null
  decided_at: string | null; decided_by: string | null; rev: number
}
export type Viewer = { id: string; role: string; clientIds: string[] | null } // null = every client

export function maySeeCampaign(v: Viewer, c: Pick<Campaign, 'client_id' | 'member_ids' | 'created_by'>): boolean
export function mayCreateFor(v: Viewer, clientId: string): boolean
export function mayEditCampaign(v: Viewer, c: Campaign): boolean          // = maySee for sa/am
export function mayDeleteCampaign(v: Viewer, c: Campaign): boolean        // sa always; am only own draft
export type Actor = 'team' | 'client'
export function stageMove(from: CreatorStage, to: CreatorStage, actor: Actor): { ok: true } | { ok: false; reason: string }
export function clientMayDecide(c: Campaign, today: string): { ok: true } | { ok: false; reason: string }
export function seatCount(c: Pick<Campaign, 'seats'>, creators: readonly Pick<CampaignCreator, 'stage'>[]):
  { seats: number | null; confirmed: number; waiting: number; open: number | null; over: boolean }
export function clientSees(c: Campaign, creators: readonly CampaignCreator[]):
  { shortlist: CampaignCreator[]; passed: CampaignCreator[]; confirmed: CampaignCreator[] } | null   // null = not shown
export function campaignCreatorId(campaignId: string, creatorId: string): string   // `${campaignId}__${creatorId}`
export function sanitiseCampaignInput(raw: unknown): Partial<Campaign>             // trims, caps, drops unknown keys
export function sanitiseCreatorInput(raw: unknown): Partial<CampaignCreator>
export function handleOf(v: unknown): string | null                                 // "@Name " / URL → "name"
```

Rules the tests pin:
- `maySeeCampaign`: `super_admin` → true. `account_manager` → `clientIds` includes `client_id`, OR `member_ids` includes `v.id`, OR `created_by === v.id` **and** (client still theirs or they are a member) — a creator who lost the client and is not a member loses it. Any other role → only if in `member_ids`.
- `mayCreateFor`: super_admin any; account_manager only `clientIds.includes(clientId)`; others false.
- Team moves: `idea→with_client`, `with_client→idea` (take back), `with_client→approved|passed` (on the client's behalf), `approved→invited`, `invited→confirmed|declined`, `confirmed→declined`, `passed→with_client`, `declined→invited`. Client moves: `with_client→approved`, `with_client→passed`, `passed→approved` (change my mind), nothing else. Same-stage is refused with "Already there".
- `clientMayDecide`: refuses when `status !== 'live'` ("This list is not open"), `!client_visible` (same words), or `closes_on && today > closes_on` ("The guest list closed on …").
- `seatCount`: `confirmed` = stage confirmed; `waiting` = invited; `open = seats === null ? null : Math.max(0, seats - confirmed - waiting)`; `over = seats !== null && confirmed > seats`.
- `clientSees`: null unless live and visible; shortlist = `with_client`; passed = `passed`; confirmed = `approved | invited | confirmed`. `idea` and `declined` never appear.

- [ ] **Step 1:** Write `tests/creator-campaign-core.test.ts` covering every rule above plus the first, third and fourth Review Focus lines.
- [ ] **Step 2:** Run `npx vitest run tests/creator-campaign-core.test.ts` — expect FAIL (module missing).
- [ ] **Step 3:** Implement the core.
- [ ] **Step 4:** Run the test — expect PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit.

### Task 2: Tables and server wrappers

**Files:**
- Modify: `scripts/gen-db-types.mjs` (ghost tables `creator_campaigns`, `creators`, `campaign_creators`, `campaign_creator_events`; the first three added to the `updatedAt` set), then regenerate `lib/db-types.ts`
- Create: `app/lib/creator-campaigns.ts`
- Test: `tests/creator-campaigns.test.ts` (fake `lib/db` the way existing route tests do)

**Interfaces — Consumes:** Task 1 types. **Produces:**

```ts
export async function viewerOf(user: TeamUser): Promise<Viewer>                       // accessibleClientIds
export async function listCampaigns(v: Viewer): Promise<(Campaign & { client_name: string; counts: ReturnType<typeof seatCount>; with_client: number })[]>
export async function loadCampaign(v: Viewer, id: string): Promise<{ campaign: Campaign; creators: CampaignCreator[]; client_name: string; portal_token: string | null } | null>  // null = not found OR not theirs
export async function createCampaign(v: Viewer, input: unknown): Promise<Campaign>   // throws AuthzError 403
export async function patchCampaign(v: Viewer, id: string, input: unknown, expectRev: number): Promise<Result<Campaign>>
export async function deleteCampaign(v: Viewer, id: string): Promise<Result<true>>
export async function addCreator(v: Viewer, campaignId: string, input: unknown): Promise<Result<CampaignCreator>>   // upserts `creators`, writes campaign_creators at 'idea'
export async function patchCreator(v: Viewer, campaignId: string, rowId: string, input: unknown, expectRev: number): Promise<Result<CampaignCreator>>
export async function moveCreator(actor: { kind: 'team'; viewer: Viewer } | { kind: 'client'; clientId: string; actorId: string }, campaignId: string, rowId: string, to: CreatorStage, expectRev: number, note?: string | null): Promise<Result<CampaignCreator>>
export async function removeCreator(v: Viewer, campaignId: string, rowId: string): Promise<Result<true>>            // only at 'idea'
export async function searchCreators(q: string): Promise<Creator[]>                                                 // the agency-wide list, by name or handle
export type Result<T> = { ok: true; value: T } | { ok: false; status: 403 | 404 | 409; reason: string; fresh?: unknown }
```

- Every write re-reads with `{ fresh: true }`, checks the rule from Task 1, and writes with `compareAndSet` on `rev` (409 "Someone changed this just now" + the fresh row on a miss).
- `moveCreator` appends a `campaign_creator_events` row (`id` minted, `campaign_id`, `row_id`, `from`, `to`, `actor_id`, `actor`, `note`, `at`).
- A client move also runs `clientMayDecide` and requires `campaign.client_id === clientId` (else 404).

- [ ] **Step 1:** Tests: AM not on the client gets null from `loadCampaign` and 403 from `createCampaign`; a stale `expectRev` returns 409 and changes nothing (Review Focus 2); a client move on another client's campaign is 404 (Review Focus 5); a client move after `closes_on` is refused (Review Focus 3).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; `tsc` clean. **Step 5:** Commit.

### Task 3: Team API

**Files:**
- Create: `app/api/creators/route.ts` (GET list, POST create), `app/api/creators/[id]/route.ts` (GET, PATCH, DELETE), `app/api/creators/[id]/creators/route.ts` (POST add), `app/api/creators/[id]/creators/[rowId]/route.ts` (PATCH, DELETE), `app/api/creators/[id]/creators/[rowId]/move/route.ts` (POST `{ to, expect_rev, note? }`), `app/api/creators/directory/route.ts` (GET `?q=`), `app/api/creators/photo/route.ts` (POST upload → R2, using the dashboard's existing upload helper)
- Modify: `middleware.ts` (add `'/api/creators(.*)'`)
- Test: `tests/creators-routes.test.ts`

Each handler: `requireSignedIn()` → `viewerOf` → the wrapper → map `Result` to a JSON response. No rule is re-implemented in a route.

- [ ] Tests: unauthenticated → 401; editor role → 403/404 on every route; AM off the client → 404 on GET and 403 on POST; happy paths return the shapes above. Then implement, run, commit.

### Task 4: The team's pages

**Files:**
- Create: `app/dashboard/creators/page.tsx` (list + New campaign dialog), `app/dashboard/creators/[id]/page.tsx` (tabs: Details · Creators · Client view), `app/dashboard/creators/CampaignCard.tsx`, `app/dashboard/creators/CreatorRow.tsx`, `app/dashboard/creators/AddCreatorDialog.tsx`, `app/dashboard/creators/stageWords.ts` (stage → label, tone, the next buttons)
- Modify: `app/dashboard/ui/Shell.tsx` (nav entry "Creator campaigns" after Clients, icon `Sparkles` or `UsersRound`), `app/lib/page-access-core.ts` (`GRANTABLE_PAGES` entry; default for super_admin and account_manager only — add an explicit branch so `general` does not inherit it)
- Test: `tests/creators-page-access.test.ts` (who sees the nav entry by default), plus the existing page-access tests still pass

Plain words on screen: "Idea", "With client", "Approved", "Passed", "Invited", "Confirmed", "Declined"; buttons "Show to client", "Take back", "Mark invited", "Mark confirmed", "Mark declined", "Approve for the client", "Pass for the client". One primary action per creator row, the rest in a menu.

- [ ] Build with `app/dashboard/ui` (PageTitle, cards, Chip, tone); render at 390px and desktop; commit.

### Task 5: The client's view

**Files:**
- Create: `app/portal/[token]/creators/page.tsx` (the client's campaigns), `app/portal/[token]/creators/[id]/page.tsx` (Overview · Shortlist · Confirmed), `app/components/portal/CreatorShortlist.tsx` (client component: Approve / Not this one / Add a note / Change my mind), `app/api/portal/creators/route.ts` (POST `{ token, campaign_id, row_id, to, expect_rev, note? }`)
- Test: `tests/portal-creators.test.ts`

- Server pages resolve `portalOwnerByToken(token)`; a campaign is loaded only when `campaign.client_id === owner.client.id` and `clientSees` is not null; otherwise `notFound()`.
- The POST resolves the token the same way, uses `portalActor(client.id, client.name)` as `actorId`, calls `moveCreator({ kind: 'client', … })`, then tells the campaign's members and the client's managers through the existing notify helper (`notifyManagersOfComment` shape, `alsoUserIds: member_ids`).
- [ ] Tests: wrong client's campaign id → 404 with no body detail; hidden or closed campaign → refusal with the plain reason; approve → row at `approved`, an event row written. Implement, render at 390px and desktop, commit.

### Task 6: Into the portal's own navigation (only if it is one small change)

**Files:** `app/lib/one-portal-core.ts`, `app/components/portal/OnePortalTabs.tsx`, `app/lib/one-portal-load.ts`

Add a "Creators" tab that appears only when the client has at least one campaign `clientSees` returns non-null for, linking to `/portal/[token]/creators`. If the tab machinery needs more than a conditional entry and a count, stop and leave version one as the direct link from the team (say so in the hand-over).

### Task 7: Proof

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`.
- [ ] Role walk on the ZZ TEST client only (read-only where the walk needs a real login the session does not have — say which steps were not walked).
- [ ] Update `docs/PROJECT_STATE.md` with a dated "Creator campaigns" section.
