# Firebase Realtime Database migration — design

**Date:** 3 September 2026
**Status:** approved in conversation, implementation starting

## Goal

Move every byte of dashboard, portal, website-CMS and pipeline data off Supabase
and onto Firebase Realtime Database (RTDB) in the existing Firebase project
`test-agent-88a4c`, copy the crucial existing data across once, then delete
Supabase from the codebase. The dashboard must feel instant and be realtime:
open boards update the moment anyone changes anything, with no reload.

## Decisions already made by the owner

| Decision | Choice |
|---|---|
| Database | Firebase **Realtime Database** (JSON tree), not Firestore |
| Server SDK | **No `firebase-admin`.** Server uses the RTDB REST API with plain `fetch`; browser uses the `firebase` web SDK (`firebase/database`) |
| Security rules | Open read/write (owner's call; the concern about `client_credentials` / `agency_credentials` was raised and accepted) |
| Cutover | One-shot import, then Supabase removed. Supabase project itself is left alone as a cold backup |
| Data skipped | `scan_runs` (23,652 rows) and `asana_events` (17,078 rows) start fresh. Everything else is copied |
| Uploads | Cloudflare R2 only. The Supabase Storage fallback is deleted |
| Auth | Clerk, unchanged |
| Namespacing | Everything lives under `/mdm`. The project's Firestore already holds `responses` and `what-drives-you-responses` from another app; RTDB is a separate database, and the `/mdm` root keeps it unmistakable anyway |

## Why the dashboard is slow today (and what fixes it)

A single route such as `app/api/production/batches/[id]` makes 11 sequential
Supabase calls; each is ~370 ms from Vercel. Boards wait on that chain. Two
things fix it:

1. **Hot screens read the database directly in the browser** with `onValue`
   listeners. No API hop, and every change anywhere is pushed to every open tab.
2. **Server routes read whole tables once per request** through a request-scoped
   cache, so a route that used to make 11 calls makes 2–3 REST reads of ~50 ms.

## Data layout

```
/mdm
  /tables/<table>/<id>          one row per child, same column names as Postgres
  /uniq/<table>/<field>/<key>   -> id, for fields that were UNIQUE in Postgres
  /live/<channel>               tiny "something changed" markers (see Realtime)
  /meta/migrated_at             ISO timestamp of the import
```

* Row ids: existing Postgres uuids are kept verbatim. New rows use
  `crypto.randomUUID()`.
* Tables whose Postgres key was composite or non-uuid get a deterministic id:
  `team_user_clients` → `${team_user_id}__${client_id}`;
  `user_page_access` → `${team_user_id}__${encodeKey(href)}`;
  `client_brand`, `drive_connection`, `scan_settings`, `intake_settings`,
  `report_settings`, `assistant_prefs` → keyed by their natural key
  (`client_id`, or `singleton`); `intake_templates` → `key`;
  `scan_mailboxes`, `calendar_accounts` → `encodeKey(email)`;
  `asana_project_map` → `project_gid`; `asana_tasks` → `gid`;
  `asana_webhooks` → `gid`.
* RTDB forbids `.  #  $  [  ]  /` in keys. `encodeKey()` percent-encodes them;
  every natural-key table above goes through it.
* Timestamps stay ISO strings. Postgres `null` is dropped on write (RTDB has no
  null). Reads normalise missing columns back to `null` using the per-table
  column list in `lib/db-types.ts`, so existing TypeScript types keep working.
* Unique constraints from Postgres become `/uniq` lookup nodes written in the
  same multi-path update as the row. The list is taken from every `unique` in
  `supabase/*.sql` during implementation (known so far: `video_previews.source_url`,
  `webhook_deliveries.provider_event_id`, `team_users.email`,
  `team_invites.email`, `newsletter_subscribers.email`).
* `.indexOn` in rules for the columns hot routes filter by: `client_id`,
  `status`, `batch_id`, `owner_id`, `team_user_id`, `created_at`,
  `scheduled_for`, `due_date`, `item_id`.
* `updated_at` triggers → the helper stamps `updated_at` on every `update` for
  the tables that had the trigger. `bookings_fill_space` → ported into the
  bookings write path.
* Tables the code queries but which never existed in Supabase
  (`website`, `content_assets`, `asset_clicks`) behave as empty tables.

## Access layer

### `lib/db.ts` — server, REST, no sockets

```ts
export function table<T extends Row>(name: TableName): Table<T>
interface Table<T> {
  get(id: string): Promise<T | null>
  list(q?: {
    by?: Partial<T>               // one equality pushed down via orderBy/equalTo
    where?: (row: T) => boolean   // everything else, in memory
    orderBy?: [keyof T, 'asc' | 'desc'][]
    limit?: number
  }): Promise<T[]>
  count(q?): Promise<number>
  insert(row: Omit<T,'id'> & { id?: string }): Promise<T>
  update(id: string, patch: Partial<T>): Promise<T | null>
  upsert(row: T, opts?: { onConflict?: keyof T }): Promise<T>
  remove(id: string): Promise<void>
  removeWhere(where: (row: T) => boolean): Promise<number>
}
export function withRequestCache<R>(fn: () => Promise<R>): Promise<R>
export function encodeKey(s: string): string
```

* `list()` fetches `/mdm/tables/<t>.json` (or with `orderBy`/`equalTo` when
  `by` is one indexed column), then filters, sorts and limits in memory.
* All reads inside one request share a cache keyed by path, so a route that
  reads `content_items` five times hits the network once. Writes invalidate.
* Writes are `PATCH` multi-path updates (row + uniq + live marker in one call)
  so a partial failure cannot leave a uniq pointer without a row.
* Joins in the old `select('*, clients(name)')` style become an explicit second
  read plus `attach()` helpers in `lib/db-join.ts`: `attachOne(rows, 'client_id',
  'clients', ['name'])`.
* Env: `NEXT_PUBLIC_FIREBASE_DATABASE_URL` (plus the web config keys). Built
  lazily so a missing var fails the request, never the build (CLAUDE.md trap 7).

### `lib/db-client.ts` — browser, web SDK, live

```ts
export function useTable<T>(name, opts?: { by?, where?, orderBy? }): { rows: T[]; loading: boolean }
export function useRow<T>(name, id): T | null | undefined
export function useLive(channel, onChange): void   // replaces Inngest realtime
```

Backed by `onValue` on `/mdm/tables/<t>` (or an `orderByChild/equalTo` query).
Initialised once from `NEXT_PUBLIC_FIREBASE_*`.

### Types

`lib/db-types.ts` declares one `interface` per table, generated from the
`supabase/*.sql` column lists during implementation, and `TableName`.

## Realtime

The existing pattern stays: messages are hints, never data. `app/lib/production-live.ts`
and the other publishers write `{ ...hint, ts }` to `/mdm/live/<channel>` with
one REST `PUT`. Browser hooks (`useProductionLive`, leads, brand, intake,
comments) become `onValue` on that node and refetch through the same
Clerk-guarded API they use today. Inngest realtime (`inngest/react`,
`app/inngest/channels.ts`, subscription-token actions) is removed. Inngest
itself stays for cron and background jobs.

Hot screens go one step further and render straight from `useTable`, so they
need no refetch at all:

* `/dashboard` overview cards
* `/dashboard/production` board, `/dashboard/editor`, `/dashboard/scheduler`
* item page `/dashboard/production/[id]` and its comments drawer
* `/dashboard/leads`

Scoping (which clients a person may see) is computed in the browser from
`team_users` + `team_user_clients` by the same pure function the server uses
(the `production-access` core), which exists already and is unit-tested.
Writes still go through the API routes, which own side effects (emails,
Zernio, R2, Inngest events).

## Migration

`scripts/migrate-supabase-to-rtdb.mjs` (Node 20, no deps beyond `fetch`):

1. For each table in `TABLES` (all 65 minus `scan_runs`, `asana_events`), page
   through Supabase REST `select=*` 1,000 rows at a time.
2. Strip nulls, compute the RTDB id per the rules above, build `/uniq` entries.
3. Write `parked/supabase-export-2026-09-03/<table>.json` (gitignored) as the
   raw backup, then `PUT /mdm/tables/<table>.json` in chunks of 500.
4. Write `/mdm/meta/migrated_at`.
5. Re-read every table's child count from RTDB (`shallow=true`) and print a
   table of Supabase count vs RTDB count; exit non-zero on any mismatch.

Idempotent: re-running replaces the same nodes. `--dry-run` reads Supabase and
prints the plan without writing.

## Cleanup

* Delete `lib/supabase.ts`, `supabase/` (SQL stays readable in git history; the
  JSON export is the data backup), `@supabase/supabase-js` from `package.json`,
  the two `SUPABASE_*` env vars from `.env.local` and Vercel, the
  `storageBackend()==='supabase'` branch, and rewrite `app/api/db-tables` to
  list `/mdm/tables` keys shallowly.
* `CLAUDE.md` stack table, trap 7 and the "run this SQL" notes in
  `docs/PROJECT_STATE.md` are rewritten for RTDB.
* `tests/plain-words.test.ts` still forbids "supabase" in user-facing copy.

## Testing

* `tests/db.test.ts`: the table helper against an in-memory fake of the RTDB
  REST surface (`fetch` mocked): get/list/by/where/orderBy/limit, insert id,
  update stamps `updated_at`, upsert onConflict, uniq collision rejected,
  request cache dedupes reads and invalidates on write, `encodeKey`.
* `tests/db-join.test.ts`: `attachOne`/`attachMany`.
* The 13 tests that mocked `@/lib/supabase` are rewritten against an
  in-memory `@/lib/db` fake (`tests/helpers/fake-db.ts`).
* Definition of done: `npm test`, `npx tsc --noEmit`, `npm run build` all pass;
  the migration verification table shows zero mismatches; the production
  board updates live in two browser tabs.

## Out of scope (separate projects)

* The dashboard visual revamp with the new shadcn skill.
* Signed playback URLs for Cloudflare Stream.
* Any change to Clerk, R2, Zernio, Asana or Inngest job logic beyond what the
  data layer swap forces.
