# Firebase Realtime Database Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase (Postgres + Storage) with Firebase Realtime Database under `/mdm`, copy the crucial existing data once, make the main boards read live from the database in the browser, and delete Supabase from the codebase.

**Architecture:** One server helper (`lib/db.ts`) talks to the RTDB REST API with plain `fetch` and a per-request cache; one browser module (`lib/db-client.ts`) uses the `firebase/database` web SDK for live `onValue` listeners. Every `supabase.from(...)` call site is rewritten against the helper; joins become explicit second reads; realtime hints move from Inngest realtime to `/mdm/live/<channel>` nodes. A one-shot Node script copies Supabase rows into `/mdm/tables/<table>/<id>`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, `firebase` web SDK (browser only), RTDB REST API (server), vitest, Node 20 (`fetch` built in).

**Spec:** `docs/superpowers/specs/2026-09-03-firebase-realtime-migration-design.md`

## Global Constraints

- **No `firebase-admin`.** Server code uses the RTDB REST API via `fetch`. Only the browser imports `firebase/*`.
- Database root is `/mdm`. Never write outside it. The project's Firestore holds another app's data; we never touch Firestore.
- Firebase project: `test-agent-88a4c`. Env vars: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_DATABASE_URL`.
- Security rules are open read/write (owner's decision). `.indexOn` still declared for hot columns.
- Tables NOT migrated: `scan_runs`, `asana_events`. Everything else is copied.
- Uploads: Cloudflare R2 only. The Supabase Storage branch is deleted, not replaced.
- Clerk auth, Inngest jobs, Zernio, Asana, R2 logic stay as they are apart from data-access lines.
- Existing Postgres uuids are kept as RTDB ids. New ids come from `crypto.randomUUID()`.
- Postgres `null` is never stored; reads normalise missing declared columns to `null`.
- Tailwind v3, classic Radix shadcn (CLAUDE.md trap 1). Do not touch styling in this project.
- Build modules lazily; a missing env var must fail the request, not `npm run build` (CLAUDE.md trap 7).
- Definition of done for the whole plan: `npm test`, `npx tsc --noEmit`, `npm run build` all pass; migration verification shows zero mismatches; two browser tabs of `/dashboard/production` update live.
- Commit after every task. Commit message trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FCQZcAEnczFkyHa5KkcKm9
  ```
- Working directory for every command is `C:\Users\User\myProjects\content\Content` (the git root).

---

## File map

| File | Responsibility |
|---|---|
| `lib/firebase-config.ts` | Reads the `NEXT_PUBLIC_FIREBASE_*` env vars, exports `firebaseConfig` and `rtdbUrl()` (lazy, throws with a plain message when missing) |
| `lib/db-types.ts` | **Generated.** One `interface` per table, `TableName`, `TABLE_COLUMNS`, `NULLABLE_COLUMNS`, `UPDATED_AT_TABLES`, `NATURAL_KEYS` |
| `scripts/gen-db-types.mjs` | Parses `supabase/*.sql` `create table` blocks and writes `lib/db-types.ts`. Run once; output committed |
| `lib/db.ts` | Server data helper: `table()`, `withRequestCache()`, `encodeKey()`, `rtdbFetch()` |
| `lib/db-join.ts` | `attachOne`, `attachMany` |
| `lib/live.ts` | Server-side `announce(channel, hint)` → `PUT /mdm/live/<channel>` |
| `lib/db-client.ts` | Browser: Firebase app init, `useTable`, `useRow`, `useLive` |
| `tests/helpers/fake-rtdb.ts` | In-memory RTDB REST fake installed on `globalThis.fetch` |
| `tests/helpers/fake-db.ts` | `vi.mock('@/lib/db')`-ready in-memory implementation of `table()` for route tests |
| `scripts/migrate-supabase-to-rtdb.mjs` | One-shot export/import with verification and `--dry-run` |
| `database.rules.json`, `firebase.json`, `.firebaserc` | Rules with `.indexOn`, CLI config |
| `app/lib/production-live.ts` | Publishers rewritten onto `lib/live.ts` |
| `app/dashboard/production/useProductionLive.ts` and the other hooks | Rewritten onto `useLive` |
| 47 `app/lib/*.ts`, 84 `app/api/**/route.ts`, 3 other files | Call sites rewritten (Tasks 8–14) |
| Hot screens | Direct `useTable` rendering (Task 15) |

---

## The rewrite recipe (used by Tasks 8–14)

Every Supabase call site maps mechanically. Read this once; every rewrite task refers back here.

| Supabase | Helper |
|---|---|
| `import { supabase } from '@/lib/supabase'` | `import { table } from '@/lib/db'` (+ `attachOne`/`attachMany` from `@/lib/db-join` when a select had a nested relation) |
| `const { data, error } = await supabase.from('t').select('*').eq('a', x).maybeSingle()` | `const row = await table<T>('t').list({ by: { a: x }, limit: 1 }).then(r => r[0] ?? null)` — or `table('t').get(id)` when the filter is `eq('id', …)` |
| `.select('cols')` | Ignore; the helper returns whole rows. TypeScript picks what's used. |
| `.eq('a', x)` (first equality) | `by: { a: x }` |
| further `.eq / .neq / .in / .is / .gte / .lte / .lt / .gt / .ilike / .not / .contains` | one `where: r => …` predicate combining them with `&&`. `ilike('name','%x%')` → `r.name?.toLowerCase().includes(x.toLowerCase())`. `.is('col', null)` → `r.col == null`. `.contains('arr',[v])` → `(r.arr ?? []).includes(v)`. `.not('col','is',null)` → `r.col != null` |
| `.or('a.eq.1,b.in.(x,y)')` | `where: r => r.a === 1 \|\| ['x','y'].includes(r.b)` (rewrite the PostgREST string by hand; there are 19 of them) |
| `.order('c', { ascending: false })` | `orderBy: [['c', 'desc']]` (several `.order` calls → several tuples in call order) |
| `.limit(n)` / `.range(a,b)` | `limit: n` / slice the array |
| `.select('*', { count: 'exact', head: true })` | `await table('t').count({ by, where })` |
| `.single()` | `const row = …[0]; if (!row) throw new Error('not found')` (keep the existing error text) |
| `.insert(obj).select().single()` | `const row = await table('t').insert(obj)` |
| `.insert([a, b])` | `await Promise.all([a, b].map(r => table('t').insert(r)))` |
| `.update(patch).eq('id', id).select().single()` | `const row = await table('t').update(id, patch)` (returns `null` when missing → keep old 404 behaviour) |
| `.update(patch).eq('a', x)` (bulk) | `const rows = await table('t').list({ by: { a: x } }); await Promise.all(rows.map(r => table('t').update(r.id, patch)))` |
| `.upsert(obj, { onConflict: 'k' })` | `await table('t').upsert(obj, { onConflict: 'k' })` |
| `.delete().eq('id', id)` | `await table('t').remove(id)` |
| `.delete().eq('a', x)` | `await table('t').removeWhere(r => r.a === x)` |
| `select('*, clients(name, timezone)')` | `const rows = await table('items').list(…); await attachOne(rows, 'client_id', 'clients', ['name','timezone'])` → each row gets `row.clients = { name, timezone } \| null` (same property name the old code read) |
| `select('*, schedule_entries(published_at)')` (one-to-many) | `await attachMany(rows, 'id', 'schedule_entries', 'item_id', ['published_at'])` → `row.schedule_entries = [...]` |
| `team_users!team_user_clients_team_user_id_fkey(...)` | `attachOne(rows, 'team_user_id', 'team_users', [...])` and read `row.team_users` |
| `if (error) throw new Error(error.message)` | Delete. The helper throws `DbError` with a plain message. |
| `error.code === '23505'` (unique violation) | `catch (e) { if (e instanceof DbError && e.code === 'unique') … }` |
| `.from('information_schema.tables')` | `listTables()` from `@/lib/db` |

Rules for the rewrite tasks:

1. Wrap the body of every route handler and every Inngest function in `withRequestCache(async () => { … })` so repeated reads of one table cost one network call. Pure `app/lib` functions do **not** wrap; they run inside the caller's cache.
2. Keep every comment that explains *why*. Delete comments that explain Supabase mechanics (`PGRST`, `maybeSingle`, RLS).
3. Keep error messages users may see word for word (`tests/plain-words.test.ts` checks copy).
4. When a file reads `updated_at` after an update, the helper has already stamped it.
5. Scan the file's imports after rewriting: remove `supabase`, add `table`, `withRequestCache`, `DbError`, `attachOne`, `attachMany` as used. Run `npx tsc --noEmit` per file group before committing.
6. A generic `T` per table comes from `lib/db-types.ts`: `table<ContentItem>('content_items')`. The name after `table<` is the PascalCase singular of the table.

---

### Task 1: Firebase config, rules, packages

**Files:**
- Create: `lib/firebase-config.ts`, `database.rules.json`, `firebase.json`, `.firebaserc`
- Modify: `package.json` (add `firebase`), `.env.local`, `.env.example` if present
- Test: `tests/firebase-config.test.ts`

**Interfaces:**
- Produces: `firebaseConfig(): { apiKey; authDomain; projectId; appId; databaseURL }`, `rtdbUrl(): string` (no trailing slash)

- [ ] **Step 1: Write the failing test**

```ts
// tests/firebase-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const KEYS = ['NEXT_PUBLIC_FIREBASE_API_KEY','NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN','NEXT_PUBLIC_FIREBASE_PROJECT_ID','NEXT_PUBLIC_FIREBASE_APP_ID','NEXT_PUBLIC_FIREBASE_DATABASE_URL'] as const
const saved: Record<string, string | undefined> = {}

describe('firebase-config', () => {
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; process.env[k] = `v-${k}` } })
  afterEach(() => { for (const k of KEYS) process.env[k] = saved[k] })

  it('reads the five public vars', async () => {
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = 'https://x-default-rtdb.firebasedatabase.app/'
    const { firebaseConfig, rtdbUrl } = await import('@/lib/firebase-config')
    expect(firebaseConfig().projectId).toBe('v-NEXT_PUBLIC_FIREBASE_PROJECT_ID')
    expect(rtdbUrl()).toBe('https://x-default-rtdb.firebasedatabase.app')
  })

  it('throws a plain message when the database url is missing', async () => {
    delete process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
    const { rtdbUrl } = await import('@/lib/firebase-config')
    expect(() => rtdbUrl()).toThrow(/NEXT_PUBLIC_FIREBASE_DATABASE_URL/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/firebase-config.test.ts`
Expected: FAIL — cannot resolve `@/lib/firebase-config`

- [ ] **Step 3: Implement**

```ts
// lib/firebase-config.ts
/**
 * Public Firebase web config. Public by design (it is shipped to browsers);
 * the database is protected by rules, not by hiding these. Read lazily so a
 * missing variable fails the request that needs it, never the build.
 */
function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

export function firebaseConfig() {
  return {
    apiKey: need('NEXT_PUBLIC_FIREBASE_API_KEY'),
    authDomain: need('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId: need('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    appId: need('NEXT_PUBLIC_FIREBASE_APP_ID'),
    databaseURL: rtdbUrl(),
  }
}

/** Realtime Database origin, no trailing slash. */
export function rtdbUrl(): string {
  return need('NEXT_PUBLIC_FIREBASE_DATABASE_URL').replace(/\/+$/, '')
}
```

```json
// database.rules.json
{
  "rules": {
    "mdm": {
      ".read": true,
      ".write": true,
      "tables": {
        "$table": {
          ".indexOn": ["client_id", "status", "batch_id", "owner_id", "team_user_id", "created_at", "scheduled_for", "due_date", "item_id", "email", "token", "updated_at"]
        }
      }
    },
    "$other": { ".read": false, ".write": false }
  }
}
```

```json
// firebase.json
{ "database": { "rules": "database.rules.json" } }
```

```json
// .firebaserc
{ "projects": { "default": "test-agent-88a4c" } }
```

Add to `.env.local` (values from the owner's config message; `DATABASE_URL` from the console once the instance exists):

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyDCuEs_N8in_7h2Esmii91UTObj8r7n344
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=test-agent-88a4c.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=test-agent-88a4c
NEXT_PUBLIC_FIREBASE_APP_ID=1:574214432022:web:a7b9f9bfccfc5df45cdc37
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
```

Run: `npm i firebase@^11`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/firebase-config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/firebase-config.ts database.rules.json firebase.json .firebaserc package.json package-lock.json tests/firebase-config.test.ts
git commit -m "feat(db): Firebase config, rules and package"
```

---

### Task 2: Generated table types

**Files:**
- Create: `scripts/gen-db-types.mjs`, `lib/db-types.ts` (generated, committed)
- Test: `tests/db-types.test.ts`

**Interfaces:**
- Produces: `TableName` union; one `interface` per table (PascalCase singular, e.g. `ContentItem`, `TeamUser`, `Client`, `Batch`, `PublishJob`); `TABLE_COLUMNS: Record<TableName, readonly string[]>`; `NULLABLE_COLUMNS: Record<TableName, readonly string[]>`; `UPDATED_AT_TABLES: ReadonlySet<TableName>`; `NATURAL_KEYS: Partial<Record<TableName, (row: any) => string>>`; `Row = { id: string } & Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db-types.test.ts
import { describe, it, expect } from 'vitest'
import { TABLE_COLUMNS, NULLABLE_COLUMNS, UPDATED_AT_TABLES, NATURAL_KEYS } from '@/lib/db-types'

describe('db-types (generated)', () => {
  it('knows the core tables and their columns', () => {
    expect(TABLE_COLUMNS.content_items).toContain('client_id')
    expect(TABLE_COLUMNS.team_users).toContain('email')
    expect(TABLE_COLUMNS.clients).toContain('name')
  })
  it('marks nullable columns', () => {
    expect(NULLABLE_COLUMNS.content_items).toContain('due_date')
    expect(NULLABLE_COLUMNS.content_items).not.toContain('id')
  })
  it('lists the tables that had an updated_at trigger', () => {
    for (const t of ['content_items','batches','team_users','projects','journal_posts','client_contacts','client_notes','client_credentials','agency_credentials','report_settings','client_agreements']) {
      expect(UPDATED_AT_TABLES.has(t as any)).toBe(true)
    }
  })
  it('derives natural keys for composite tables', () => {
    expect(NATURAL_KEYS.team_user_clients!({ team_user_id: 'u1', client_id: 'c1' })).toBe('u1__c1')
    expect(NATURAL_KEYS.user_page_access!({ team_user_id: 'u1', href: '/dashboard/x' })).toBe('u1__%2Fdashboard%2Fx')
    expect(NATURAL_KEYS.scan_mailboxes!({ email: 'a.b@x.com' })).toBe('a%2Eb@x%2Ecom')
    expect(NATURAL_KEYS.asana_tasks!({ gid: '123' })).toBe('123')
    expect(NATURAL_KEYS.scan_settings!({})).toBe('singleton')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db-types.test.ts`
Expected: FAIL — cannot resolve `@/lib/db-types`

- [ ] **Step 3: Write the generator**

```js
// scripts/gen-db-types.mjs
// Parses every `create table` in supabase/*.sql and writes lib/db-types.ts.
// Later `alter table … add column` statements are folded in. Run:
//   node scripts/gen-db-types.mjs
import fs from 'node:fs'
import path from 'node:path'

const SQL_DIR = 'supabase'
const OUT = 'lib/db-types.ts'
const SKIP = new Set(['public']) // false positive from "create table public.x" forms

const PG_TO_TS = [
  [/^(uuid|text|varchar|character varying|citext|date|timestamptz|timestamp|time|inet)/i, 'string'],
  [/^(int|integer|bigint|smallint|numeric|decimal|real|double|float|serial)/i, 'number'],
  [/^(bool|boolean)/i, 'boolean'],
  [/^(jsonb|json)/i, 'unknown'],
  [/^text\[\]/i, 'string[]'],
  [/^uuid\[\]/i, 'string[]'],
]
function tsType(pg) {
  if (/\[\]\s*$/.test(pg)) return 'string[]'
  for (const [re, t] of PG_TO_TS) if (re.test(pg)) return t
  return 'unknown'
}

const tables = new Map() // name -> Map(col -> {type, nullable})
const updatedAt = new Set()

for (const f of fs.readdirSync(SQL_DIR).filter(f => f.endsWith('.sql'))) {
  const sql = fs.readFileSync(path.join(SQL_DIR, f), 'utf8').replace(/--[^\n]*/g, '')
  for (const m of sql.matchAll(/create table(?: if not exists)?\s+(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\);/gi)) {
    const [, name, body] = m
    if (SKIP.has(name)) continue
    const cols = tables.get(name) ?? new Map()
    for (const line of splitTopLevel(body)) {
      const t = line.trim()
      if (!t || /^(primary key|unique|constraint|check|foreign key)/i.test(t)) continue
      const cm = t.match(/^"?([a-z_]+)"?\s+([a-z_ \[\]]+(?:\([^)]*\))?)/i)
      if (!cm) continue
      const [, col, type] = cm
      const nullable = !/not null/i.test(t) && !/primary key/i.test(t)
      cols.set(col, { type: tsType(type.trim()), nullable })
    }
    tables.set(name, cols)
  }
  for (const m of sql.matchAll(/alter table(?: if exists)?\s+(?:public\.)?([a-z_]+)\s+add column(?: if not exists)?\s+"?([a-z_]+)"?\s+([a-z_ \[\]]+(?:\([^)]*\))?)([^;]*);/gi)) {
    const [, name, col, type, rest] = m
    const cols = tables.get(name) ?? new Map()
    cols.set(col, { type: tsType(type.trim()), nullable: !/not null/i.test(rest) })
    tables.set(name, cols)
  }
  for (const m of sql.matchAll(/create trigger\s+[a-z_]+_updated_at\s+before update on\s+(?:public\.)?([a-z_]+)/gi)) updatedAt.add(m[1])
}

// tables the code queries but no SQL ever created
for (const ghost of ['website']) if (!tables.has(ghost)) tables.set(ghost, new Map([['id', { type: 'string', nullable: false }]]))
for (const t of tables.values()) if (!t.has('id')) t.set('id', { type: 'string', nullable: false })

function splitTopLevel(s) {
  const out = []; let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}
const pascal = n => n.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase()).replace(/s$/, m => (n.endsWith('ss') || n.endsWith('us') ? m : ''))

const names = [...tables.keys()].sort()
let out = `// GENERATED by scripts/gen-db-types.mjs from supabase/*.sql — do not edit by hand.\n\n`
out += `export type Row = { id: string } & Record<string, unknown>\n\n`
out += `export type TableName =\n${names.map(n => `  | '${n}'`).join('\n')}\n\n`
for (const n of names) {
  out += `export interface ${pascal(n)} {\n`
  for (const [c, { type, nullable }] of tables.get(n)) out += `  ${c}: ${type}${nullable ? ' | null' : ''}\n`
  out += `}\n\n`
}
out += `export const TABLE_COLUMNS = {\n${names.map(n => `  ${n}: [${[...tables.get(n).keys()].map(c => `'${c}'`).join(', ')}],`).join('\n')}\n} as const satisfies Record<TableName, readonly string[]>\n\n`
out += `export const NULLABLE_COLUMNS = {\n${names.map(n => `  ${n}: [${[...tables.get(n)].filter(([, v]) => v.nullable).map(([c]) => `'${c}'`).join(', ')}],`).join('\n')}\n} as const satisfies Record<TableName, readonly string[]>\n\n`
out += `export const UPDATED_AT_TABLES: ReadonlySet<TableName> = new Set<TableName>([${[...updatedAt].sort().map(t => `'${t}'`).join(', ')}])\n\n`
out += `export function encodeKey(s: string): string {\n  return s.replace(/[.#$\\[\\]\\/%]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))\n}\n\n`
out += `/** Tables whose Postgres key was not a uuid \`id\`. The id stored in RTDB is derived from the row. */\nexport const NATURAL_KEYS: Partial<Record<TableName, (row: any) => string>> = {
  team_user_clients: r => \`\${r.team_user_id}__\${r.client_id}\`,
  user_page_access: r => \`\${r.team_user_id}__\${encodeKey(r.href)}\`,
  client_brand: r => r.client_id,
  drive_connection: () => 'singleton',
  scan_settings: () => 'singleton',
  intake_settings: () => 'singleton',
  report_settings: r => r.client_id ?? 'singleton',
  assistant_prefs: r => r.team_user_id ?? r.user_id ?? 'singleton',
  intake_templates: r => encodeKey(r.key),
  scan_mailboxes: r => encodeKey(r.email),
  calendar_accounts: r => encodeKey(r.email),
  asana_project_map: r => r.project_gid,
  asana_tasks: r => r.gid,
  asana_webhooks: r => r.gid ?? r.id,
}\n`
fs.writeFileSync(OUT, out)
console.log(`wrote ${OUT}: ${names.length} tables`)
```

Run: `node scripts/gen-db-types.mjs`, then open `lib/db-types.ts` and check three things by hand: `ContentItem` has `client_id`, `status`, `due_date: string | null`; `report_settings` and `assistant_prefs` natural keys match the real primary keys in `supabase/report_settings.sql` and `supabase/assistant.sql` (edit the `NATURAL_KEYS` block in the script if not, re-run); every table name in the rewrite recipe's file list exists in `TableName`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db-types.test.ts`
Expected: PASS (4 tests). If a column the test names is missing, the SQL parser missed a form — fix the regex, do not hand-edit the output.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-db-types.mjs lib/db-types.ts tests/db-types.test.ts
git commit -m "feat(db): generate table types from the SQL schema"
```

---

### Task 3: In-memory RTDB fake for tests

**Files:**
- Create: `tests/helpers/fake-rtdb.ts`
- Test: `tests/fake-rtdb.test.ts`

**Interfaces:**
- Produces: `installFakeRtdb(seed?: object): { tree: () => any; calls: () => { method: string; path: string }[]; restore: () => void }`. It sets `process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = 'https://fake.firebasedatabase.app'` and replaces `globalThis.fetch` with an implementation of `GET/PUT/PATCH/DELETE <url>/<path>.json` supporting `?shallow=true`, `?orderBy="col"&equalTo="v"` (values JSON-encoded), multi-path `PATCH` bodies (`{"a/b": 1, "c": null}`), and `null` meaning delete.

- [ ] **Step 1: Write the failing test**

```ts
// tests/fake-rtdb.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'

let fake: ReturnType<typeof installFakeRtdb>
afterEach(() => fake?.restore())

const U = 'https://fake.firebasedatabase.app'

describe('fake rtdb', () => {
  it('GET/PUT/PATCH/DELETE round-trip', async () => {
    fake = installFakeRtdb()
    await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', body: JSON.stringify({ id: 'a', n: 1 }) })
    await fetch(`${U}/mdm.json`, { method: 'PATCH', body: JSON.stringify({ 'tables/t/b': { id: 'b', n: 2 }, 'tables/t/a/n': 5 }) })
    expect(await (await fetch(`${U}/mdm/tables/t.json`)).json()).toEqual({ a: { id: 'a', n: 5 }, b: { id: 'b', n: 2 } })
    await fetch(`${U}/mdm/tables/t/a.json`, { method: 'DELETE' })
    expect(await (await fetch(`${U}/mdm/tables/t/a.json`)).json()).toBeNull()
  })
  it('shallow and equalTo queries', async () => {
    fake = installFakeRtdb({ mdm: { tables: { t: { a: { id: 'a', c: 'x' }, b: { id: 'b', c: 'y' } } } } })
    expect(await (await fetch(`${U}/mdm/tables/t.json?shallow=true`)).json()).toEqual({ a: true, b: true })
    const r = await (await fetch(`${U}/mdm/tables/t.json?orderBy=${encodeURIComponent('"c"')}&equalTo=${encodeURIComponent('"y"')}`)).json()
    expect(r).toEqual({ b: { id: 'b', c: 'y' } })
  })
  it('null in a PATCH deletes', async () => {
    fake = installFakeRtdb({ mdm: { x: 1, y: 2 } })
    await fetch(`${U}/mdm.json`, { method: 'PATCH', body: JSON.stringify({ x: null }) })
    expect(fake.tree().mdm).toEqual({ y: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fake-rtdb.test.ts`
Expected: FAIL — cannot resolve `./helpers/fake-rtdb`

- [ ] **Step 3: Implement**

```ts
// tests/helpers/fake-rtdb.ts
/**
 * The Realtime Database REST surface, in memory, on globalThis.fetch.
 * Just enough for lib/db.ts and the migration script: GET (shallow,
 * orderBy+equalTo), PUT, PATCH (multi-path), DELETE, null-deletes.
 */
type Json = any
const ORIGIN = 'https://fake.firebasedatabase.app'

function getAt(tree: Json, segs: string[]): Json {
  let cur = tree
  for (const s of segs) { if (cur == null || typeof cur !== 'object') return null; cur = cur[s] }
  return cur === undefined ? null : cur
}
function setAt(tree: Json, segs: string[], value: Json) {
  if (segs.length === 0) return value ?? {}
  let cur = tree
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur[segs[i]] == null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {}
    cur = cur[segs[i]]
  }
  const last = segs[segs.length - 1]
  if (value === null || value === undefined) delete cur[last]; else cur[last] = value
  return tree
}
function prune(node: Json): Json {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const k of Object.keys(node)) { node[k] = prune(node[k]); if (node[k] === null || (typeof node[k] === 'object' && Object.keys(node[k]).length === 0)) delete node[k] }
    return Object.keys(node).length ? node : null
  }
  return node
}

export function installFakeRtdb(seed: Json = {}) {
  let tree: Json = structuredClone(seed)
  const calls: { method: string; path: string }[] = []
  const real = globalThis.fetch
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = ORIGIN

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    if (url.origin !== ORIGIN) return real(input, init)
    const method = (init.method ?? 'GET').toUpperCase()
    const segs = url.pathname.replace(/\.json$/, '').split('/').filter(Boolean)
    calls.push({ method, path: '/' + segs.join('/') })
    const body = init.body ? JSON.parse(init.body) : undefined
    const respond = (v: Json, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

    if (method === 'GET') {
      let node = structuredClone(getAt(tree, segs))
      const orderBy = url.searchParams.get('orderBy'), equalTo = url.searchParams.get('equalTo')
      if (orderBy && equalTo !== null && node && typeof node === 'object') {
        const col = JSON.parse(orderBy), val = JSON.parse(equalTo)
        node = Object.fromEntries(Object.entries(node).filter(([, r]: any) => r?.[col] === val))
        if (!Object.keys(node).length) node = null
      }
      if (url.searchParams.get('shallow') === 'true' && node && typeof node === 'object') node = Object.fromEntries(Object.keys(node).map(k => [k, true]))
      return respond(node)
    }
    if (method === 'PUT') { tree = prune(setAt(tree, segs, body)) ?? {}; return respond(body) }
    if (method === 'PATCH') {
      for (const [k, v] of Object.entries(body)) tree = setAt(tree, [...segs, ...k.split('/').filter(Boolean)], v)
      tree = prune(tree) ?? {}
      return respond(body)
    }
    if (method === 'DELETE') { tree = prune(setAt(tree, segs, null)) ?? {}; return respond(null) }
    return respond({ error: 'unsupported' }, 400)
  }) as typeof fetch

  return { tree: () => tree, calls: () => calls, restore: () => { globalThis.fetch = real } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fake-rtdb.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/fake-rtdb.ts tests/fake-rtdb.test.ts
git commit -m "test(db): in-memory Realtime Database REST fake"
```

---

### Task 4: `lib/db.ts` — the server table helper

**Files:**
- Create: `lib/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: `rtdbUrl()` (Task 1); `TABLE_COLUMNS`, `NULLABLE_COLUMNS`, `UPDATED_AT_TABLES`, `NATURAL_KEYS`, `encodeKey`, `TableName`, `Row` (Task 2); `installFakeRtdb` (Task 3, tests only).
- Produces:

```ts
export class DbError extends Error { code: 'unique' | 'network' | 'not_found' | 'bad_request' }
export type ListQuery<T> = { by?: Partial<T>; where?: (row: T) => boolean; orderBy?: [keyof T & string, 'asc' | 'desc'][]; limit?: number }
export interface Table<T extends Row> {
  name: TableName
  get(id: string): Promise<T | null>
  list(q?: ListQuery<T>): Promise<T[]>
  count(q?: ListQuery<T>): Promise<number>
  insert(row: Omit<T, 'id'> & { id?: string }): Promise<T>
  update(id: string, patch: Partial<T>): Promise<T | null>
  upsert(row: Partial<T> & { id?: string }, opts?: { onConflict?: keyof T & string }): Promise<T>
  remove(id: string): Promise<void>
  removeWhere(where: (row: T) => boolean): Promise<number>
}
export function table<T extends Row>(name: TableName): Table<T>
export function withRequestCache<R>(fn: () => Promise<R>): Promise<R>
export function listTables(): Promise<string[]>
export function rtdbFetch(path: string, init?: RequestInit & { query?: Record<string, string> }): Promise<any>
export { encodeKey } from './db-types'
export const UNIQUE_COLUMNS: Partial<Record<TableName, readonly string[]>>
```

`UNIQUE_COLUMNS` (from `supabase/*.sql`, single-column uniques only; composite ones are enforced by call sites already):
`team_users: ['email','clerk_user_id']`, `team_invites: ['email']`, `newsletter_subscribers: ['email']`, `video_previews: ['source_url']`, `webhook_deliveries: ['provider_event_id']`, `email_ingest_log: ['gmail_message_id']`, `post_analytics: ['provider_post_id']`, `publish_jobs: ['dedupe_key']`, `notification_log: ['dedup_key']`, `asana_project_map: ['project_gid']`, `work_kinds: ['slug']`, `projects: ['slug']`, `intake_forms: ['token']`, `monthly_updates: ['token']`, `clients: ['share_token']`, `client_brand: ['client_id']`, `social_accounts: ['provider_post_id']`. Verify each against the SQL while implementing; drop any that is not actually declared unique.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { table, withRequestCache, DbError, listTables } from '@/lib/db'
import type { Client, ContentItem } from '@/lib/db-types'

let fake: ReturnType<typeof installFakeRtdb>
const seed = () => ({ mdm: { tables: {
  clients: { c1: { id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne' }, c2: { id: 'c2', name: 'Bee' } },
  content_items: {
    i1: { id: 'i1', client_id: 'c1', status: 'draft', title: 'A', updated_at: '2026-01-02T00:00:00Z' },
    i2: { id: 'i2', client_id: 'c1', status: 'approved', title: 'B', updated_at: '2026-01-03T00:00:00Z' },
    i3: { id: 'i3', client_id: 'c2', status: 'draft', title: 'C', updated_at: '2026-01-01T00:00:00Z' },
  },
  team_users: { u1: { id: 'u1', email: 'a@x.com', name: 'A' } },
}, uniq: { team_users: { email: { 'a@x%2Ecom': 'u1' } } } } })

beforeEach(() => { fake = installFakeRtdb(seed()) })
afterEach(() => fake.restore())

describe('table().get / list', () => {
  it('get returns the row with nullable columns normalised to null', async () => {
    const c = await table<Client>('clients').get('c2')
    expect(c?.name).toBe('Bee')
    expect(c?.timezone).toBeNull()
    expect(await table<Client>('clients').get('nope')).toBeNull()
  })
  it('list with by pushes one equality down as an indexed query', async () => {
    const rows = await table<ContentItem>('content_items').list({ by: { client_id: 'c1' } })
    expect(rows.map(r => r.id).sort()).toEqual(['i1', 'i2'])
    expect(fake.calls().at(-1)!.path).toBe('/mdm/tables/content_items')
  })
  it('where, orderBy desc, limit', async () => {
    const rows = await table<ContentItem>('content_items').list({ where: r => r.status === 'draft', orderBy: [['updated_at', 'desc']], limit: 1 })
    expect(rows.map(r => r.id)).toEqual(['i1'])
  })
  it('count', async () => {
    expect(await table<ContentItem>('content_items').count({ by: { status: 'draft' } })).toBe(2)
  })
  it('empty table lists as []', async () => {
    expect(await table('website' as any).list()).toEqual([])
  })
})

describe('table() writes', () => {
  it('insert mints a uuid, strips nulls, returns the row', async () => {
    const row = await table<ContentItem>('content_items').insert({ client_id: 'c2', status: 'draft', title: 'D', due_date: null } as any)
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.tree().mdm.tables.content_items[row.id].due_date).toBeUndefined()
    expect(row.due_date).toBeNull()
  })
  it('update stamps updated_at on trigger tables and returns null for a missing row', async () => {
    const before = Date.now()
    const row = await table<ContentItem>('content_items').update('i1', { title: 'Z' })
    expect(row?.title).toBe('Z')
    expect(Date.parse(row!.updated_at as string)).toBeGreaterThanOrEqual(before - 1000)
    expect(await table<ContentItem>('content_items').update('nope', { title: 'Z' })).toBeNull()
  })
  it('remove and removeWhere', async () => {
    await table('clients').remove('c2')
    expect(fake.tree().mdm.tables.clients.c2).toBeUndefined()
    expect(await table<ContentItem>('content_items').removeWhere(r => r.client_id === 'c1')).toBe(2)
    expect(Object.keys(fake.tree().mdm.tables.content_items)).toEqual(['i3'])
  })
  it('upsert onConflict updates the existing row', async () => {
    const r = await table<Client>('clients').upsert({ name: 'Acme', timezone: 'UTC' } as any, { onConflict: 'name' })
    expect(r.id).toBe('c1')
    expect(fake.tree().mdm.tables.clients.c1.timezone).toBe('UTC')
  })
  it('unique columns are enforced through /uniq', async () => {
    await expect(table('team_users').insert({ email: 'a@x.com', name: 'Dup' } as any)).rejects.toMatchObject({ code: 'unique' })
    const u = await table('team_users').insert({ email: 'b@x.com', name: 'B' } as any)
    expect(fake.tree().mdm.uniq.team_users.email['b@x%2Ecom']).toBe(u.id)
    await table('team_users').remove(u.id)
    expect(fake.tree().mdm.uniq.team_users.email['b@x%2Ecom']).toBeUndefined()
  })
  it('natural-key tables derive their id', async () => {
    const r = await table('team_user_clients').insert({ team_user_id: 'u1', client_id: 'c1' } as any)
    expect(r.id).toBe('u1__c1')
  })
})

describe('withRequestCache', () => {
  it('dedupes reads inside one request and invalidates on write', async () => {
    await withRequestCache(async () => {
      const n0 = fake.calls().length
      await table('clients').list(); await table('clients').list(); await table('clients').get('c1')
      expect(fake.calls().length - n0).toBe(1)
      await table('clients').update('c1', { name: 'New' })
      const c = await table<Client>('clients').get('c1')
      expect(c?.name).toBe('New')
    })
  })
  it('outside a request cache every read hits the network', async () => {
    const n0 = fake.calls().length
    await table('clients').list(); await table('clients').list()
    expect(fake.calls().length - n0).toBe(2)
  })
})

describe('errors and misc', () => {
  it('listTables reads the shallow key list', async () => {
    expect(await listTables()).toEqual(['clients', 'content_items', 'team_users'])
  })
  it('a non-2xx becomes DbError network', async () => {
    fake.restore()
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as any
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = 'https://fake.firebasedatabase.app'
    await expect(table('clients').list()).rejects.toBeInstanceOf(DbError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — cannot resolve `@/lib/db`

- [ ] **Step 3: Implement**

```ts
// lib/db.ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { rtdbUrl } from './firebase-config'
import {
  NATURAL_KEYS, NULLABLE_COLUMNS, UPDATED_AT_TABLES, encodeKey,
  type Row, type TableName,
} from './db-types'

export { encodeKey }

/**
 * Server-side access to Firebase Realtime Database over its REST API.
 *
 * No firebase-admin and no sockets: a serverless function that opens a
 * websocket to read one row pays for the handshake on every cold start and
 * then has to remember to close it. A REST GET is one HTTPS call and done.
 *
 * Every table is a flat node /mdm/tables/<table>/<id>. list() reads the node
 * (or an indexed orderBy/equalTo slice) and filters in memory — honest for a
 * JSON tree, instant at this size, and every read inside one request is
 * served from a request-scoped cache so a route that touches the same table
 * five times pays once.
 */

export class DbError extends Error {
  code: 'unique' | 'network' | 'not_found' | 'bad_request'
  constructor(code: DbError['code'], message: string) { super(message); this.code = code; this.name = 'DbError' }
}

export type ListQuery<T> = {
  by?: Partial<T>
  where?: (row: T) => boolean
  orderBy?: [keyof T & string, 'asc' | 'desc'][]
  limit?: number
}

export interface Table<T extends Row> {
  name: TableName
  get(id: string): Promise<T | null>
  list(q?: ListQuery<T>): Promise<T[]>
  count(q?: ListQuery<T>): Promise<number>
  insert(row: Omit<T, 'id'> & { id?: string }): Promise<T>
  update(id: string, patch: Partial<T>): Promise<T | null>
  upsert(row: Partial<T> & { id?: string }, opts?: { onConflict?: keyof T & string }): Promise<T>
  remove(id: string): Promise<void>
  removeWhere(where: (row: T) => boolean): Promise<number>
}

/** Single-column UNIQUE constraints carried over from Postgres. */
export const UNIQUE_COLUMNS: Partial<Record<TableName, readonly string[]>> = {
  team_users: ['email', 'clerk_user_id'],
  team_invites: ['email'],
  newsletter_subscribers: ['email'],
  video_previews: ['source_url'],
  webhook_deliveries: ['provider_event_id'],
  email_ingest_log: ['gmail_message_id'],
  post_analytics: ['provider_post_id'],
  publish_jobs: ['dedupe_key'],
  notification_log: ['dedup_key'],
  asana_project_map: ['project_gid'],
  work_kinds: ['slug'],
  projects: ['slug'],
  intake_forms: ['token'],
  monthly_updates: ['token'],
  clients: ['share_token'],
}

const ROOT = '/mdm'

// ---- transport ------------------------------------------------------------

export async function rtdbFetch(path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<any> {
  const { query, ...rest } = init
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  const url = `${rtdbUrl()}${path}.json${qs}`
  let res: Response
  try {
    res = await fetch(url, { ...rest, headers: { 'content-type': 'application/json', ...(rest.headers ?? {}) }, cache: 'no-store' })
  } catch (e) {
    throw new DbError('network', `Database unreachable: ${(e as Error).message}`)
  }
  if (!res.ok) throw new DbError(res.status === 400 ? 'bad_request' : 'network', `Database ${rest.method ?? 'GET'} ${path} failed (${res.status})`)
  return res.json()
}

// ---- request cache ----------------------------------------------------------

const als = new AsyncLocalStorage<Map<string, Promise<any>>>()

/** Run `fn` with a read cache: identical GETs inside it hit the network once. Writes invalidate the table. */
export function withRequestCache<R>(fn: () => Promise<R>): Promise<R> {
  return als.run(new Map(), fn)
}
function cachedGet(path: string, query?: Record<string, string>): Promise<any> {
  const store = als.getStore()
  const key = path + (query ? '?' + new URLSearchParams(query).toString() : '')
  if (!store) return rtdbFetch(path, { query })
  let p = store.get(key)
  if (!p) { p = rtdbFetch(path, { query }); store.set(key, p) }
  return p
}
function invalidate(name: string) {
  const store = als.getStore()
  if (!store) return
  for (const k of [...store.keys()]) if (k.startsWith(`${ROOT}/tables/${name}`) || k.startsWith(`${ROOT}/uniq/${name}`)) store.delete(k)
}

// ---- row shaping ------------------------------------------------------------

function stripNulls<T extends object>(row: T): T {
  const out: any = {}
  for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined) out[k] = v
  return out
}
function normalise<T>(name: TableName, id: string, raw: any): T {
  const row: any = { ...raw, id: raw?.id ?? id }
  for (const c of NULLABLE_COLUMNS[name] ?? []) if (row[c] === undefined) row[c] = null
  return row as T
}
function idFor(name: TableName, row: any): string {
  if (row.id) return String(row.id)
  const nk = NATURAL_KEYS[name]
  return nk ? nk(row) : crypto.randomUUID()
}
function sortRows<T>(rows: T[], orderBy: ListQuery<T>['orderBy']) {
  if (!orderBy?.length) return rows
  return rows.sort((a: any, b: any) => {
    for (const [col, dir] of orderBy) {
      const x = a[col], y = b[col]
      if (x === y) continue
      if (x == null) return 1
      if (y == null) return -1
      const c = x < y ? -1 : 1
      return dir === 'desc' ? -c : c
    }
    return 0
  })
}

// ---- the table -------------------------------------------------------------

export function table<T extends Row>(name: TableName): Table<T> {
  const base = `${ROOT}/tables/${name}`
  const uniques = UNIQUE_COLUMNS[name] ?? []

  async function readAll(by?: Partial<T>): Promise<T[]> {
    let node: any
    let rest: Partial<T> = {}
    if (by && Object.keys(by).length) {
      const [[col, val], ...others] = Object.entries(by)
      rest = Object.fromEntries(others) as Partial<T>
      node = val == null ? await cachedGet(base) : await cachedGet(base, { orderBy: JSON.stringify(col), equalTo: JSON.stringify(val) })
      if (val == null) rest = by
    } else node = await cachedGet(base)
    let rows = node ? Object.entries(node).map(([id, r]) => normalise<T>(name, id, r)) : []
    const restEntries = Object.entries(rest)
    if (restEntries.length) rows = rows.filter((r: any) => restEntries.every(([k, v]) => r[k] === v))
    return rows
  }

  async function uniqChecks(row: any, selfId: string): Promise<Record<string, string>> {
    const patch: Record<string, string> = {}
    for (const col of uniques) {
      const v = row[col]
      if (v == null) continue
      const key = `${ROOT}/uniq/${name}/${col}/${encodeKey(String(v))}`
      const owner = await cachedGet(key)
      if (owner && owner !== selfId) throw new DbError('unique', `${name}.${col} already exists`)
      patch[`uniq/${name}/${col}/${encodeKey(String(v))}`] = selfId
    }
    return patch
  }
  function uniqClears(row: any): Record<string, null> {
    const patch: Record<string, null> = {}
    for (const col of uniques) if (row?.[col] != null) patch[`uniq/${name}/${col}/${encodeKey(String(row[col]))}`] = null
    return patch
  }

  const t: Table<T> = {
    name,
    async get(id) {
      const raw = await cachedGet(`${base}/${id}`)
      return raw ? normalise<T>(name, id, raw) : null
    },
    async list(q = {}) {
      let rows = await readAll(q.by)
      if (q.where) rows = rows.filter(q.where)
      rows = sortRows(rows, q.orderBy)
      if (q.limit != null) rows = rows.slice(0, q.limit)
      return rows
    },
    async count(q = {}) {
      let rows = await readAll(q.by)
      if (q.where) rows = rows.filter(q.where)
      return rows.length
    },
    async insert(input) {
      const id = idFor(name, input)
      const now = new Date().toISOString()
      const row: any = stripNulls({ created_at: now, ...(input as any), id })
      if (UPDATED_AT_TABLES.has(name)) row.updated_at = row.updated_at ?? now
      const patch: Record<string, unknown> = { [`tables/${name}/${id}`]: row, ...(await uniqChecks(row, id)) }
      await rtdbFetch(ROOT, { method: 'PATCH', body: JSON.stringify(patch) })
      invalidate(name)
      return normalise<T>(name, id, row)
    },
    async update(id, patch) {
      const current = await cachedGet(`${base}/${id}`)
      if (!current) return null
      const next: any = { ...current, ...(patch as any), id }
      if (UPDATED_AT_TABLES.has(name)) next.updated_at = new Date().toISOString()
      const body: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(patch as any)) body[`tables/${name}/${id}/${k}`] = v === undefined ? null : v
      if (UPDATED_AT_TABLES.has(name)) body[`tables/${name}/${id}/updated_at`] = next.updated_at
      const changedUniques = uniques.filter(c => c in (patch as any) && (patch as any)[c] !== current[c])
      if (changedUniques.length) {
        Object.assign(body, uniqClears(Object.fromEntries(changedUniques.map(c => [c, current[c]]))))
        Object.assign(body, await uniqChecks(Object.fromEntries(changedUniques.map(c => [c, next[c]])), id))
      }
      await rtdbFetch(ROOT, { method: 'PATCH', body: JSON.stringify(body) })
      invalidate(name)
      return normalise<T>(name, id, stripNulls(next))
    },
    async upsert(row, opts) {
      const key = opts?.onConflict
      if (key && (row as any)[key] != null) {
        const existing = (await readAll({ [key]: (row as any)[key] } as Partial<T>))[0]
        if (existing) return (await t.update(existing.id, row)) as T
      } else if (row.id) {
        const existing = await t.get(row.id)
        if (existing) return (await t.update(row.id, row)) as T
      }
      return t.insert(row as any)
    },
    async remove(id) {
      const current = await cachedGet(`${base}/${id}`)
      const body: Record<string, unknown> = { [`tables/${name}/${id}`]: null, ...uniqClears(current) }
      await rtdbFetch(ROOT, { method: 'PATCH', body: JSON.stringify(body) })
      invalidate(name)
    },
    async removeWhere(where) {
      const rows = (await readAll()).filter(where)
      if (!rows.length) return 0
      const body: Record<string, unknown> = {}
      for (const r of rows) { body[`tables/${name}/${r.id}`] = null; Object.assign(body, uniqClears(r)) }
      await rtdbFetch(ROOT, { method: 'PATCH', body: JSON.stringify(body) })
      invalidate(name)
      return rows.length
    },
  }
  return t
}

/** Names of tables that currently hold at least one row. */
export async function listTables(): Promise<string[]> {
  const node = await rtdbFetch(`${ROOT}/tables`, { query: { shallow: 'true' } })
  return node ? Object.keys(node).sort() : []
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS (14 tests). Also run `npx tsc --noEmit` — `node:async_hooks` is available in the Node runtime that Next.js route handlers use; confirm no route is on the Edge runtime (`grep -rn "runtime = 'edge'" app` must be empty).

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts tests/db.test.ts
git commit -m "feat(db): Realtime Database table helper with request cache and unique keys"
```

---

### Task 5: `lib/db-join.ts` and `lib/live.ts`

**Files:**
- Create: `lib/db-join.ts`, `lib/live.ts`
- Test: `tests/db-join.test.ts`, `tests/live.test.ts`

**Interfaces:**
- Consumes: `table`, `rtdbFetch` (Task 4).
- Produces:

```ts
// lib/db-join.ts
export async function attachOne<T extends object, K extends string>(rows: T[], fk: keyof T & string, target: TableName, cols: readonly string[], as?: K): Promise<(T & Record<K, Record<string, unknown> | null>)[]>
export async function attachMany<T extends object, K extends string>(rows: T[], localKey: keyof T & string, target: TableName, foreignKey: string, cols: readonly string[], as?: K): Promise<(T & Record<K, Record<string, unknown>[]>)[]>
// lib/live.ts
export type LiveChannel = 'production' | 'leads' | 'brand' | 'intake' | 'monthly' | 'tracker' | 'comments'
export function announce(channel: LiveChannel, hint: Record<string, unknown>): void   // fire-and-forget PUT /mdm/live/<channel>
```

`as` defaults to the target table name, so `attachOne(rows,'client_id','clients',['name'])` sets `row.clients`, matching what call sites already read.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db-join.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { attachOne, attachMany } from '@/lib/db-join'

let fake: ReturnType<typeof installFakeRtdb>
beforeEach(() => { fake = installFakeRtdb({ mdm: { tables: {
  clients: { c1: { id: 'c1', name: 'Acme', timezone: 'UTC', secret: 'x' } },
  schedule_entries: { s1: { id: 's1', item_id: 'i1', published_at: 'p1' }, s2: { id: 's2', item_id: 'i1' }, s3: { id: 's3', item_id: 'i2' } },
} } }) })
afterEach(() => fake.restore())

describe('attachOne', () => {
  it('attaches the picked columns under the table name, null when missing', async () => {
    const rows = await attachOne([{ id: 'i1', client_id: 'c1' }, { id: 'i2', client_id: 'zz' }, { id: 'i3', client_id: null }], 'client_id', 'clients', ['name', 'timezone'])
    expect(rows[0].clients).toEqual({ name: 'Acme', timezone: 'UTC' })
    expect(rows[1].clients).toBeNull()
    expect(rows[2].clients).toBeNull()
  })
  it('reads the target table once', async () => {
    const n0 = fake.calls().length
    await attachOne([{ client_id: 'c1' }, { client_id: 'c1' }], 'client_id', 'clients', ['name'], 'client')
    expect(fake.calls().length - n0).toBe(1)
  })
})
describe('attachMany', () => {
  it('attaches arrays keyed by the foreign key', async () => {
    const rows = await attachMany([{ id: 'i1' }, { id: 'i9' }], 'id', 'schedule_entries', 'item_id', ['published_at'])
    expect(rows[0].schedule_entries).toEqual([{ published_at: 'p1' }, { published_at: null }])
    expect(rows[1].schedule_entries).toEqual([])
  })
})
```

```ts
// tests/live.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { announce } from '@/lib/live'

let fake: ReturnType<typeof installFakeRtdb>
beforeEach(() => { fake = installFakeRtdb() })
afterEach(() => fake.restore())

describe('announce', () => {
  it('PUTs the hint with a ts to /mdm/live/<channel> and never throws', async () => {
    announce('production', { item_id: 'i1', client_id: 'c1', status: 'draft', kind: 'updated' })
    await new Promise(r => setTimeout(r, 0))
    const node = fake.tree().mdm.live.production
    expect(node.item_id).toBe('i1')
    expect(typeof node.ts).toBe('number')
  })
  it('swallows transport failures', async () => {
    fake.restore()
    globalThis.fetch = (async () => { throw new Error('down') }) as any
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = 'https://fake.firebasedatabase.app'
    expect(() => announce('leads', { id: 'x' })).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db-join.test.ts tests/live.test.ts`
Expected: FAIL — cannot resolve modules

- [ ] **Step 3: Implement**

```ts
// lib/db-join.ts
import { table } from './db'
import type { Row, TableName } from './db-types'

function pick(src: any, cols: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const c of cols) out[c] = src?.[c] ?? null
  return out
}

/** Postgres-style `select('*, clients(name)')`: one target row per source row, or null. */
export async function attachOne<T extends object, K extends string = TableName>(
  rows: T[], fk: keyof T & string, target: TableName, cols: readonly string[], as?: K,
): Promise<(T & Record<K, Record<string, unknown> | null>)[]> {
  const key = (as ?? target) as K
  if (!rows.length) return rows as any
  const targets = await table<Row>(target).list()
  const byId = new Map(targets.map(r => [r.id, r]))
  return rows.map(r => ({ ...r, [key]: (r as any)[fk] != null && byId.has((r as any)[fk]) ? pick(byId.get((r as any)[fk]), cols) : null })) as any
}

/** Postgres-style `select('*, schedule_entries(published_at)')`: an array per source row. */
export async function attachMany<T extends object, K extends string = TableName>(
  rows: T[], localKey: keyof T & string, target: TableName, foreignKey: string, cols: readonly string[], as?: K,
): Promise<(T & Record<K, Record<string, unknown>[]>)[]> {
  const key = (as ?? target) as K
  if (!rows.length) return rows as any
  const targets = await table<Row>(target).list()
  const groups = new Map<unknown, Record<string, unknown>[]>()
  for (const t of targets) {
    const g = groups.get((t as any)[foreignKey]) ?? []
    g.push(pick(t, cols)); groups.set((t as any)[foreignKey], g)
  }
  return rows.map(r => ({ ...r, [key]: groups.get((r as any)[localKey]) ?? [] })) as any
}
```

```ts
// lib/live.ts
import { rtdbFetch } from './db'

/**
 * "Something changed" markers. Every open board listens to /mdm/live/<channel>
 * and refetches through its own authenticated API — the marker is a hint,
 * never data, so role and client scoping is always re-applied server-side.
 * Fire-and-forget: the write that caused it has already committed, and a lost
 * hint costs one refresh, not data.
 */
export type LiveChannel = 'production' | 'leads' | 'brand' | 'intake' | 'monthly' | 'tracker' | 'comments'

export function announce(channel: LiveChannel, hint: Record<string, unknown>): void {
  void rtdbFetch(`/mdm/live/${channel}`, { method: 'PUT', body: JSON.stringify({ ...hint, ts: Date.now() }) })
    .catch(e => console.error(`live announce (${channel}) failed:`, (e as Error).message))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db-join.test.ts tests/live.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db-join.ts lib/live.ts tests/db-join.test.ts tests/live.test.ts
git commit -m "feat(db): join helpers and live change markers"
```

---

### Task 6: Browser module `lib/db-client.ts`

**Files:**
- Create: `lib/db-client.ts`
- Test: `tests/db-client-core.test.ts` (pure parts only; the Firebase SDK is not exercised in vitest)

**Interfaces:**
- Consumes: `firebaseConfig()` (Task 1), `NULLABLE_COLUMNS` (Task 2).
- Produces:

```ts
export function snapshotToRows<T>(name: TableName, val: Record<string, any> | null): T[]   // pure, tested
export function applyQuery<T>(rows: T[], q: { where?: (r: T) => boolean; orderBy?: [keyof T & string, 'asc'|'desc'][]; limit?: number }): T[]   // pure, tested
export function useTable<T extends Row>(name: TableName, opts?: { by?: Partial<T>; where?: (r: T) => boolean; orderBy?: [...]; limit?: number; enabled?: boolean }): { rows: T[]; loading: boolean; error: string | null }
export function useRow<T extends Row>(name: TableName, id: string | null | undefined): { row: T | null; loading: boolean }
export function useLive(channel: LiveChannel, onChange: (hint: Record<string, unknown> & { ts: number }) => void, opts?: { pollMs?: number }): void
```

`useLive` keeps the belt-and-braces poll from today's `useProductionLive` (visibility-aware interval, fires on tab return) and dedupes on `ts`. `useTable` opens `onValue(ref(db, '/mdm/tables/<name>'))` or `query(ref, orderByChild(col), equalTo(val))` when `by` has one key; `where`/`orderBy`/`limit` run through `applyQuery` in a `useMemo`. The app is initialised once with `getApps().length ? getApp() : initializeApp(firebaseConfig())`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/db-client-core.test.ts
import { describe, it, expect } from 'vitest'
import { snapshotToRows, applyQuery } from '@/lib/db-client'

describe('db-client pure parts', () => {
  it('snapshotToRows normalises nullable columns and injects id', () => {
    const rows = snapshotToRows<any>('content_items', { i1: { title: 'A' }, i2: { id: 'i2', title: 'B', due_date: 'd' } })
    expect(rows.find(r => r.id === 'i1')?.due_date).toBeNull()
    expect(rows.find(r => r.id === 'i2')?.due_date).toBe('d')
    expect(snapshotToRows('content_items', null)).toEqual([])
  })
  it('applyQuery filters, sorts, limits', () => {
    const out = applyQuery([{ n: 2, s: 'x' }, { n: 1, s: 'x' }, { n: 3, s: 'y' }], { where: r => r.s === 'x', orderBy: [['n', 'desc']], limit: 1 })
    expect(out).toEqual([{ n: 2, s: 'x' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db-client-core.test.ts`
Expected: FAIL — cannot resolve `@/lib/db-client`

- [ ] **Step 3: Implement**

```ts
// lib/db-client.ts
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getApp, getApps, initializeApp } from 'firebase/app'
import { getDatabase, ref, query, orderByChild, equalTo, onValue, type Query } from 'firebase/database'
import { firebaseConfig } from './firebase-config'
import { NULLABLE_COLUMNS, type Row, type TableName } from './db-types'
import type { LiveChannel } from './live'

/**
 * Live reads straight from Realtime Database in the browser: the board
 * renders from a snapshot and re-renders the instant anyone changes a row.
 * Writes still go through the API routes, which own side effects.
 */

function db() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig())
  return getDatabase(app)
}

export function snapshotToRows<T>(name: TableName, val: Record<string, any> | null): T[] {
  if (!val) return []
  const nullable = NULLABLE_COLUMNS[name] ?? []
  return Object.entries(val).map(([id, r]) => {
    const row: any = { ...r, id: r?.id ?? id }
    for (const c of nullable) if (row[c] === undefined) row[c] = null
    return row as T
  })
}

export type ClientQuery<T> = { where?: (r: T) => boolean; orderBy?: [keyof T & string, 'asc' | 'desc'][]; limit?: number }

export function applyQuery<T>(rows: T[], q: ClientQuery<T>): T[] {
  let out = q.where ? rows.filter(q.where) : rows.slice()
  if (q.orderBy?.length) {
    const ob = q.orderBy
    out.sort((a: any, b: any) => {
      for (const [col, dir] of ob) {
        const x = a[col], y = b[col]
        if (x === y) continue
        if (x == null) return 1
        if (y == null) return -1
        return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1)
      }
      return 0
    })
  }
  if (q.limit != null) out = out.slice(0, q.limit)
  return out
}

export function useTable<T extends Row>(
  name: TableName,
  opts: ClientQuery<T> & { by?: Partial<T>; enabled?: boolean } = {},
) {
  const [raw, setRaw] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const byKey = opts.by ? JSON.stringify(opts.by) : ''
  const enabled = opts.enabled ?? true

  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    let q: Query = ref(db(), `/mdm/tables/${name}`)
    const by = byKey ? (JSON.parse(byKey) as Record<string, unknown>) : null
    if (by) {
      const [[col, val]] = Object.entries(by)
      if (val != null) q = query(q, orderByChild(col), equalTo(val as string | number | boolean))
    }
    setLoading(true)
    const off = onValue(q, snap => { setRaw(snap.val()); setLoading(false); setError(null) }, e => { setError(e.message); setLoading(false) })
    return off
  }, [name, byKey, enabled])

  const rows = useMemo(() => {
    let r = snapshotToRows<T>(name, raw)
    const by = byKey ? (JSON.parse(byKey) as Record<string, unknown>) : null
    if (by) { const entries = Object.entries(by).slice(1); if (entries.length) r = r.filter((row: any) => entries.every(([k, v]) => row[k] === v)) }
    return applyQuery(r, opts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, name, byKey, opts.where, opts.orderBy, opts.limit])

  return { rows, loading, error }
}

export function useRow<T extends Row>(name: TableName, id: string | null | undefined) {
  const [row, setRow] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(id))
  useEffect(() => {
    if (!id) { setRow(null); setLoading(false); return }
    setLoading(true)
    return onValue(ref(db(), `/mdm/tables/${name}/${id}`), snap => {
      const v = snap.val()
      setRow(v ? snapshotToRows<T>(name, { [id]: v })[0] : null)
      setLoading(false)
    })
  }, [name, id])
  return { row, loading }
}

/**
 * Subscribe to a change marker. Same contract as the old Inngest hook: the
 * callback refetches through its own authenticated API. Includes the
 * visibility-aware poll so a dropped socket or a sleeping laptop still
 * catches up. Keep `onChange` referentially stable (useCallback).
 */
export function useLive(channel: LiveChannel, onChange: (hint: Record<string, unknown> & { ts: number }) => void, opts?: { pollMs?: number }) {
  const lastTs = useRef(0)
  useEffect(() => {
    return onValue(ref(db(), `/mdm/live/${channel}`), snap => {
      const v = snap.val() as (Record<string, unknown> & { ts: number }) | null
      if (!v?.ts || v.ts === lastTs.current) return
      const first = lastTs.current === 0
      lastTs.current = v.ts
      if (!first) onChange(v)  // the initial snapshot is history, not news
    })
  }, [channel, onChange])
  useEffect(() => {
    const tick = () => { if (!document.hidden) onChange({ ts: Date.now() }) }
    const id = window.setInterval(tick, opts?.pollMs ?? 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [onChange, opts?.pollMs])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db-client-core.test.ts` then `npx tsc --noEmit`
Expected: PASS (2 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db-client.ts tests/db-client-core.test.ts
git commit -m "feat(db): browser live table hooks"
```

---

### Task 7: Migration script (dry run now, real run when the database URL exists)

**Files:**
- Create: `scripts/migrate-supabase-to-rtdb.mjs`
- Modify: `.gitignore` (confirm `parked/` is ignored — it is, line 76)
- Test: `tests/migrate-core.test.ts` against `scripts/migrate-core.mjs` (the pure parts, split out so they can be imported)

**Interfaces:**
- Consumes: the same `NATURAL_KEYS`/`encodeKey` rules as Task 2 (duplicated in plain JS in `scripts/migrate-core.mjs` because the script runs without TypeScript; keep them byte-identical in behaviour, the test pins it).
- Produces: `parked/supabase-export-2026-09-03/<table>.json`, `/mdm/tables/*`, `/mdm/uniq/*`, `/mdm/meta/migrated_at`, a verification table.

- [ ] **Step 1: Write the failing test**

```ts
// tests/migrate-core.test.ts
import { describe, it, expect } from 'vitest'
// @ts-expect-error plain js
import { rowToNode, buildUniq, TABLES, SKIPPED } from '../scripts/migrate-core.mjs'

describe('migrate-core', () => {
  it('skips exactly the two log tables', () => {
    expect(SKIPPED).toEqual(['scan_runs', 'asana_events'])
    expect(TABLES).not.toContain('scan_runs')
    expect(TABLES).toContain('content_items')
    expect(TABLES).toContain('assets')
  })
  it('keeps uuids, derives natural keys, strips nulls', () => {
    expect(rowToNode('clients', { id: 'c1', name: 'A', timezone: null })).toEqual(['c1', { id: 'c1', name: 'A' }])
    expect(rowToNode('team_user_clients', { team_user_id: 'u', client_id: 'c' })).toEqual(['u__c', { team_user_id: 'u', client_id: 'c', id: 'u__c' }])
    expect(rowToNode('scan_mailboxes', { email: 'a.b@x.com' })[0]).toBe('a%2Eb@x%2Ecom')
  })
  it('builds uniq pointers only for declared unique columns', () => {
    const uniq = buildUniq('team_users', [['u1', { email: 'a@x.com' }], ['u2', { email: null }]])
    expect(uniq).toEqual({ 'team_users/email/a@x%2Ecom': 'u1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/migrate-core.test.ts`
Expected: FAIL — cannot resolve `scripts/migrate-core.mjs`

- [ ] **Step 3: Implement**

```js
// scripts/migrate-core.mjs — pure parts of the migration, tested.
export const SKIPPED = ['scan_runs', 'asana_events']
export const TABLES = [
  'agency_credentials','approvals','asana_project_map','asana_tasks','asana_webhooks','asset_versions','assets',
  'assistant_chats','assistant_prefs','batch_comments','batches','booking_availability','booking_blackouts',
  'booking_resources','booking_services','bookings','calendar_accounts','client_agreements','client_brand',
  'client_contacts','client_credentials','client_notes','clients','content_items','deliverable_groups',
  'drive_connection','drive_files','email_ingest_log','intake_files','intake_forms','intake_settings',
  'intake_templates','item_comments','journal_posts','leads','monthly_commitments','monthly_updates',
  'newsletter_subscribers','notification_log','post_analytics','projects','provider_webhooks','publish_jobs',
  'report_settings','room_invite_requests','scan_mailboxes','scan_settings','schedule_entries','shoot_proposals',
  'social_accounts','team_invites','team_user_clients','team_users','user_page_access','video_previews',
  'webhook_deliveries','work_kinds','workflow_activity',
]
export const UNIQUE_COLUMNS = {
  team_users: ['email', 'clerk_user_id'], team_invites: ['email'], newsletter_subscribers: ['email'],
  video_previews: ['source_url'], webhook_deliveries: ['provider_event_id'], email_ingest_log: ['gmail_message_id'],
  post_analytics: ['provider_post_id'], publish_jobs: ['dedupe_key'], notification_log: ['dedup_key'],
  asana_project_map: ['project_gid'], work_kinds: ['slug'], projects: ['slug'], intake_forms: ['token'],
  monthly_updates: ['token'], clients: ['share_token'],
}
export function encodeKey(s) { return String(s).replace(/[.#$\[\]\/%]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) }
const NATURAL_KEYS = {
  team_user_clients: r => `${r.team_user_id}__${r.client_id}`,
  user_page_access: r => `${r.team_user_id}__${encodeKey(r.href)}`,
  client_brand: r => r.client_id,
  drive_connection: () => 'singleton', scan_settings: () => 'singleton', intake_settings: () => 'singleton',
  report_settings: r => r.client_id ?? 'singleton',
  assistant_prefs: r => r.team_user_id ?? r.user_id ?? 'singleton',
  intake_templates: r => encodeKey(r.key), scan_mailboxes: r => encodeKey(r.email), calendar_accounts: r => encodeKey(r.email),
  asana_project_map: r => r.project_gid, asana_tasks: r => r.gid, asana_webhooks: r => r.gid ?? r.id,
}
export function rowToNode(table, row) {
  const id = row.id != null ? String(row.id) : (NATURAL_KEYS[table] ? NATURAL_KEYS[table](row) : null)
  if (!id) throw new Error(`${table}: row has no id and no natural key: ${JSON.stringify(row).slice(0, 120)}`)
  const node = {}
  for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined) node[k] = v
  if (!row.id) node.id = id
  return [id, node]
}
export function buildUniq(table, entries) {
  const out = {}
  for (const col of UNIQUE_COLUMNS[table] ?? []) for (const [id, node] of entries) if (node[col] != null) out[`${table}/${col}/${encodeKey(node[col])}`] = id
  return out
}
```

```js
// scripts/migrate-supabase-to-rtdb.mjs
// One-shot copy of Supabase → Firebase Realtime Database under /mdm.
//   node scripts/migrate-supabase-to-rtdb.mjs --dry-run   # read + report, write nothing
//   node scripts/migrate-supabase-to-rtdb.mjs             # export JSON backup, import, verify
import fs from 'node:fs'
import path from 'node:path'
import { TABLES, SKIPPED, rowToNode, buildUniq } from './migrate-core.mjs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const RTDB = (env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? '').replace(/\/+$/, '')
const DRY = process.argv.includes('--dry-run')
const OUT_DIR = 'parked/supabase-export-2026-09-03'
if (!SB || !SB_KEY) throw new Error('Supabase env missing')
if (!DRY && !RTDB) throw new Error('NEXT_PUBLIC_FIREBASE_DATABASE_URL missing — create the Realtime Database first')

async function readTable(t) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB}/rest/v1/${t}?select=*`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: `${from}-${from + 999}`, Prefer: 'count=exact' } })
    if (r.status === 404) return null   // never created in Supabase
    if (!r.ok && r.status !== 416) throw new Error(`${t}: ${r.status} ${await r.text()}`)
    const page = r.ok ? await r.json() : []
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}
async function rt(pathname, method = 'GET', body) {
  const r = await fetch(`${RTDB}${pathname}.json${method === 'GET' ? '?shallow=true' : ''}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  if (!r.ok) throw new Error(`RTDB ${method} ${pathname}: ${r.status} ${await r.text()}`)
  return r.json()
}

const report = []
fs.mkdirSync(OUT_DIR, { recursive: true })
let uniqAll = {}
for (const t of TABLES) {
  const rows = await readTable(t)
  if (rows === null) { report.push([t, 'missing in Supabase', 0, '-']); continue }
  fs.writeFileSync(path.join(OUT_DIR, `${t}.json`), JSON.stringify(rows, null, 1))
  const entries = rows.map(r => rowToNode(t, r))
  const ids = new Set(entries.map(([id]) => id))
  if (ids.size !== entries.length) throw new Error(`${t}: ${entries.length - ids.size} duplicate ids after key derivation`)
  Object.assign(uniqAll, buildUniq(t, entries))
  if (!DRY) {
    const node = Object.fromEntries(entries)
    await rt(`/mdm/tables/${t}`, 'PUT', Object.keys(node).length ? node : null)
    const back = await rt(`/mdm/tables/${t}`)
    const n = back ? Object.keys(back).length : 0
    report.push([t, 'copied', rows.length, n])
  } else report.push([t, 'would copy', rows.length, '-'])
}
if (!DRY) {
  await rt('/mdm/uniq', 'PUT', Object.keys(uniqAll).length ? unflatten(uniqAll) : null)
  await rt('/mdm/meta', 'PUT', { migrated_at: new Date().toISOString(), skipped: SKIPPED })
}
function unflatten(flat) { const o = {}; for (const [k, v] of Object.entries(flat)) { const segs = k.split('/'); let c = o; for (const s of segs.slice(0, -1)) c = c[s] ??= {}; c[segs.at(-1)] = v } return o }

console.log(`\n${'table'.padEnd(26)} ${'status'.padEnd(20)} ${'supabase'.padStart(9)} ${'rtdb'.padStart(6)}`)
let bad = 0
for (const [t, s, a, b] of report) { const mismatch = b !== '-' && a !== b; if (mismatch) bad++; console.log(`${t.padEnd(26)} ${s.padEnd(20)} ${String(a).padStart(9)} ${String(b).padStart(6)}${mismatch ? '  MISMATCH' : ''}`) }
console.log(`\nskipped on purpose: ${SKIPPED.join(', ')}`)
console.log(DRY ? 'dry run — nothing written' : bad ? `${bad} MISMATCH(ES)` : 'all counts match')
process.exit(bad ? 1 : 0)
```

- [ ] **Step 4: Run the test, then the dry run**

Run: `npx vitest run tests/migrate-core.test.ts` → PASS (3 tests).
Run: `node scripts/migrate-supabase-to-rtdb.mjs --dry-run` → a table of every migrated table with its Supabase row count, `dry run — nothing written`, exit 0. Delete `parked/supabase-export-2026-09-03` afterwards if you want a clean tree; the real run recreates it.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-core.mjs scripts/migrate-supabase-to-rtdb.mjs tests/migrate-core.test.ts
git commit -m "feat(db): one-shot Supabase to Realtime Database migration script"
```

- [ ] **Step 6: Real run (only once `NEXT_PUBLIC_FIREBASE_DATABASE_URL` is set in `.env.local`)**

Run: `npx --no-install firebase deploy --only database --project test-agent-88a4c` (needs a login that owns the project; otherwise paste `database.rules.json` into the console's Rules tab) then `node scripts/migrate-supabase-to-rtdb.mjs`.
Expected: `all counts match`, exit 0. Spot-check in the console: `/mdm/tables/clients` has 16 children, `/mdm/tables/team_users` 34.

---

### Task 8: Realtime publishers and hooks moved off Inngest realtime

**Files:**
- Modify: `app/lib/production-live.ts`, `app/dashboard/production/useProductionLive.ts`, `app/dashboard/production/actions.ts`, `app/dashboard/leads/actions.ts`, `app/dashboard/leads/page.tsx`, `app/dashboard/tracker/actions.ts`, `app/dashboard/tracker/page.tsx`, `app/dashboard/clients/[id]/actions.ts`, `app/dashboard/clients/[id]/brandActions.ts`, `app/dashboard/clients/[id]/BrandPanel.tsx`, `app/dashboard/clients/[id]/IntakePanel.tsx`, `app/dashboard/clients/[id]/MonthlyPanel.tsx`, `app/dashboard/clients/[id]/monthly-actions.ts`, `app/dashboard/clients/[id]/intake/[formId]/page.tsx`, `app/dashboard/clients/[id]/monthly/[formId]/page.tsx`, every server module that calls `inngest.realtime.publish(...)` (find with `grep -rn "realtime.publish" app`)
- Delete: `app/inngest/channels.ts`
- Test: existing tests must still pass; `tests/production-live.test.ts` (new, small)

**Interfaces:**
- Consumes: `announce` (Task 5), `useLive` (Task 6).
- Produces: `announceItemChange`, `announceBookingChange`, `announceBatchChange` keep their signatures; `useProductionLive(onChange, opts)` keeps its signature.

- [ ] **Step 1: Write the failing test**

```ts
// tests/production-live.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { announceItemChange, announceBatchChange, announceBookingChange } from '@/app/lib/production-live'

let fake: ReturnType<typeof installFakeRtdb>
beforeEach(() => { fake = installFakeRtdb() })
afterEach(() => fake.restore())
const flush = () => new Promise(r => setTimeout(r, 0))

describe('production-live', () => {
  it('item, batch and booking changes all land on /mdm/live/production', async () => {
    announceItemChange({ item_id: 'i1', client_id: 'c1', status: 'draft', kind: 'updated' }); await flush()
    expect(fake.tree().mdm.live.production.item_id).toBe('i1')
    announceBatchChange({ batch_id: 'b1', client_id: 'c1', status: 'open', kind: 'updated' }); await flush()
    expect(fake.tree().mdm.live.production.item_id).toBe('batch:b1')
    announceBookingChange({ booking_id: 'k1', kind: 'moved' }); await flush()
    expect(fake.tree().mdm.live.production.item_id).toBe('booking:k1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/production-live.test.ts`
Expected: FAIL — `production-live` still imports `../inngest/client` and publishes through Inngest (the fake sees no `/mdm/live` write).

- [ ] **Step 3: Rewrite the publishers**

`app/lib/production-live.ts` becomes:

```ts
import 'server-only'
import { announce } from '@/lib/live'

/** Announce that a production item changed … (keep the existing doc comments) */
export function announceItemChange(args: { item_id: string; client_id: string; status: string; kind: 'created' | 'transition' | 'version' | 'comment' | 'schedule' | 'updated' }) {
  announce('production', args)
}
export function announceBookingChange(args: { booking_id: string; kind: string }) {
  announce('production', { item_id: `booking:${args.booking_id}`, client_id: 'booking', status: args.kind, kind: 'updated' })
}
export function announceBatchChange(args: { batch_id: string; client_id: string; status: string; kind: 'created' | 'updated' | 'transition' | 'deleted' }) {
  announce('production', { item_id: `batch:${args.batch_id}`, client_id: args.client_id, status: args.status, kind: 'updated' })
}
```

For every other `inngest.realtime.publish(<channel>.<topic>, payload)` found by `grep -rn "realtime.publish" app`: replace with `announce('<channel>', payload)` where the channel name is the Inngest channel's `name` (`leads`, `brand`, `intake`, `monthly`, `tracker`; comments ride `production`). Drop the `ts` from the payload if the call site added one; `announce` adds it.

- [ ] **Step 4: Rewrite the hooks**

`app/dashboard/production/useProductionLive.ts` becomes:

```ts
'use client'
import { useCallback } from 'react'
import { useLive } from '@/lib/db-client'

export type ProductionChange = { item_id: string; client_id: string; status: string; kind: string; ts: number }

/** (keep the existing doc comment; replace "Inngest" with "Realtime Database") */
export function useProductionLive(onChange: (change?: ProductionChange) => void, opts?: { pollMs?: number }) {
  const handler = useCallback((hint: Record<string, unknown> & { ts: number }) => {
    onChange(hint.item_id ? (hint as unknown as ProductionChange) : undefined)
  }, [onChange])
  useLive('production', handler, opts)
}
```

Every other page/panel that uses `useRealtime({ channel, topics, token: () => fetchXSubscriptionToken() … })`: replace with `useLive('<channel>', handler)` where `handler` filters on `client_id`/`form_id` exactly as the old `messages.last` effect did, then refetches. Delete the `fetch*SubscriptionToken` server actions in the `actions.ts` files and the `getSubscriptionToken` imports. Delete `app/inngest/channels.ts`. `grep -rn "inngest/react\|inngest/realtime\|channels'" app lib` must return nothing.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/production-live.test.ts` → PASS. `npx tsc --noEmit` → clean. `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add -A app/lib/production-live.ts app/dashboard app/inngest tests/production-live.test.ts
git commit -m "feat(live): change markers on Realtime Database replace Inngest realtime"
```

---

### Task 9: In-memory `@/lib/db` fake for route tests, and the 13 old tests

**Files:**
- Create: `tests/helpers/fake-db.ts`
- Modify: `tests/brand-profile-route.test.ts`, `tests/external-post-match.test.ts`, `tests/portal-data.test.ts`, `tests/portal-plan-note-route.test.ts`, `tests/production-access.test.ts`, `tests/stream-webhook.test.ts`, `tests/version-slides-route.test.ts`, `tests/zernio-webhook-route.test.ts` (and any other file `grep -l "lib/supabase" tests` lists)

**Interfaces:**
- Produces: `makeFakeDb(seed: Partial<Record<TableName, Row[]>>)` returning `{ table, withRequestCache, DbError, listTables, encodeKey, rows: (name) => Row[] }` — the exact export surface of `@/lib/db`, implemented on the real `lib/db.ts` code running against `installFakeRtdb`. That way route tests exercise the real helper.

- [ ] **Step 1: Implement the helper**

```ts
// tests/helpers/fake-db.ts
import { installFakeRtdb } from './fake-rtdb'
import type { Row, TableName } from '@/lib/db-types'

/**
 * Seed a fake Realtime Database and hand back the real `@/lib/db` running
 * against it. Use in route tests:
 *   const fake = seedDb({ clients: [{ id: 'c1', name: 'Acme' }] })
 *   afterEach(() => fake.restore())
 */
export function seedDb(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<string, Record<string, Row>> = {}
  for (const [t, rows] of Object.entries(seed)) tables[t] = Object.fromEntries((rows ?? []).map(r => [r.id, r]))
  const fake = installFakeRtdb({ mdm: { tables } })
  return {
    ...fake,
    rows: (name: TableName): Row[] => Object.values(fake.tree().mdm?.tables?.[name] ?? {}),
  }
}
```

- [ ] **Step 2: Rewrite each old test**

For each file: delete the hand-rolled `const supabase = { from: … }` builder and the `vi.mock('@/lib/supabase', …)`. Replace with `const fake = seedDb({ … })` in `beforeEach` (seed the same rows the old builder returned) and `afterEach(() => fake.restore())`. Assertions that inspected the builder's recorded calls (`expect(updates).toEqual(...)`) become assertions on `fake.rows('table')`. Because these tests import routes that are rewritten in Tasks 10–14, do this task **after** those tasks for any test whose route still imports `@/lib/supabase`; `tests/production-access.test.ts` and `tests/portal-data.test.ts` pair with Task 10, the route tests with Tasks 12–14. The plan lists it here so the helper exists before the rewrites start.

- [ ] **Step 3: Verify and commit**

Run: `npm test` → all pass, and `grep -l "lib/supabase" tests` → nothing.

```bash
git add tests
git commit -m "test: route tests run the real db helper against an in-memory Realtime Database"
```

---

### Task 10: Rewrite `app/lib` group A — access, team, clients, workflow

**Files (16):** `app/lib/authz.ts`, `app/lib/page-access.ts`, `app/lib/production-access.ts`, `app/lib/portal-actor.ts`, `app/lib/portal-data.ts`, `app/lib/portal-thread.ts`, `app/lib/workflow.ts`, `app/lib/comment-tags.ts`, `app/lib/due-reminders.ts`, `app/lib/shoots.ts`, `app/lib/schedule.ts`, `app/lib/posting-approval.ts`, `app/lib/production-publish.ts`, `app/lib/publish.ts`, `app/lib/monthly.ts`, `app/lib/tracker.ts`

**Interfaces:** every exported function keeps its name, parameters and return shape. Only the body's data access changes.

- [ ] **Step 1:** For each file, apply the rewrite recipe. Worked example — `accessibleClientIds` in `production-access.ts` today:

```ts
const { data } = await supabase.from('team_user_clients').select('client_id').eq('team_user_id', user.id)
return (data ?? []).map(r => r.client_id)
```
becomes
```ts
const rows = await table<TeamUserClient>('team_user_clients').list({ by: { team_user_id: user.id } })
return rows.map(r => r.client_id)
```

And `assignedItemsFilter(user)` which today returns a PostgREST `or` **string** consumed by routes: change it to return a **predicate** `(item: ContentItem) => boolean` with the same semantics (owner, scheduler_ids contains, tagged ids, shoot ids). Update its doc comment and its callers (`app/api/production/items/route.ts`, `loadItemForUser`) in Task 12, where the `q.or(…)` becomes `where: r => clientIds.includes(r.client_id) || assigned(r)`.

- [ ] **Step 2:** After each file: `npx tsc --noEmit 2>&1 | grep "<file>"` must be empty (other files still erroring on the old string contract is expected until Task 12).
- [ ] **Step 3:** Rewrite `tests/production-access.test.ts` and `tests/portal-data.test.ts` per Task 9. Run `npx vitest run tests/production-access.test.ts tests/portal-data.test.ts` → PASS.
- [ ] **Step 4: Commit** `git commit -am "refactor(db): app/lib access, team, workflow modules on Realtime Database"`

---

### Task 11: Rewrite `app/lib` group B — integrations and pipelines

**Files (31):** `app/lib/asana.ts`, `app/lib/asana-sync.ts`, `app/lib/assistant-chats.ts`, `app/lib/assistant-tools.ts`, `app/lib/booking.ts`, `app/lib/booking-notify.ts`, `app/lib/brand-profile.ts`, `app/lib/brand-scan.ts`, `app/lib/email-lead.ts`, `app/lib/external-post-match.ts`, `app/lib/gcal.ts`, `app/lib/gdrive.ts`, `app/lib/gdrive-hooks.ts`, `app/lib/gdrive-members.ts`, `app/lib/gdrive-mirror.ts`, `app/lib/inbox-connect.ts`, `app/lib/intake.ts`, `app/lib/intake-enrich.ts`, `app/lib/journalPosts.ts`, `app/lib/lead-enrichment.ts`, `app/lib/mailer.ts`, `app/lib/post-analytics.ts`, `app/lib/report-data.ts`, `app/lib/report-send.ts`, `app/lib/scan-settings.ts`, `app/lib/social-connect.ts`, `app/lib/stream.ts`, `app/lib/websiteData.ts`, `app/lib/zernio-events.ts`, `app/lib/zernio-webhook.ts`, `app/lib/storage.ts`

Special cases:
- `app/lib/storage.ts`: delete `storageBackend()`'s `'supabase'` value and the Supabase upload branch; `storageBackend()` returns `'r2'` only, and `presignUpload` throws `new Error('File storage is not configured')` when `!r2Configured()`. Remove the `supabase` import. Update `app/api/website/upload/route.ts` in Task 14 to match.
- `app/lib/booking.ts`: port the `bookings_fill_space` trigger — when inserting a booking with `space` unset, fill it from the resource the same way the SQL does (read the function body in `supabase/booking_space.sql` and reproduce it in TypeScript beside the insert). The no-double-booking unique index becomes a check-then-insert inside `withRequestCache` with the existing conflict error message.
- `app/lib/stream.ts`: `video_previews.source_url` uniqueness is now enforced by the helper; catch `DbError` `unique` where the code caught `23505`.
- `app/lib/zernio-webhook.ts` / `webhook_deliveries.provider_event_id`: same pattern.
- `app/lib/brand-scan.ts` and `scan-settings.ts`: `scan_runs` is empty after migration; the code path stays, it just starts fresh.
- `app/lib/asana-sync.ts`: `asana_events` likewise; `asana_tasks` rows are keyed by `gid` (natural key) — `upsert(row, { onConflict: 'gid' })` works because `gid` maps to the id.

- [ ] **Step 1:** Apply the recipe file by file. `npx tsc --noEmit 2>&1 | grep "app/lib/"` → empty when done.
- [ ] **Step 2:** Rewrite `tests/external-post-match.test.ts`, `tests/stream-webhook.test.ts`, `tests/brand-profile-route.test.ts` (its lib half) per Task 9. `npm test` → the lib-only suites pass; route suites may still fail until Tasks 12–14.
- [ ] **Step 3: Commit** `git commit -am "refactor(db): app/lib integrations and pipelines on Realtime Database"`

---

### Task 12: Rewrite `app/api/production/**` (23 routes)

**Files:** `app/api/production/at-risk/route.ts`, `batches/[id]/comments/route.ts`, `batches/[id]/pdf/route.ts`, `batches/[id]/route.ts`, `batches/[id]/transition/route.ts`, `batches/route.ts`, `commitments/route.ts`, `deliverables-progress/route.ts`, `groups/[id]/route.ts`, `groups/route.ts`, `items/[id]/claim/route.ts`, `items/[id]/comments/route.ts`, `items/[id]/handoff/route.ts`, `items/[id]/publish/route.ts`, `items/[id]/route.ts`, `items/[id]/transition/route.ts`, `items/[id]/versions/route.ts`, `items/route.ts`, `schedule/route.ts`, `work-kinds/[id]/route.ts`, `work-kinds/route.ts`, `work-kinds/suggest/route.ts`

- [ ] **Step 1:** Wrap each handler: `export async function GET(req: Request) { return withRequestCache(async () => { …existing body… }) }`. Apply the recipe. Worked example for the `items` GET list (the trickiest one):

```ts
const clientIds = await accessibleClientIds(user)
const assigned = user.role === 'client' ? null : await assignedItemsFilter(user)   // now a predicate
let rows = await table<ContentItem>('content_items').list({
  by: clientFilter ? { client_id: clientFilter } : undefined,
  where: r => {
    if (clientIds !== null) {
      if (user.role === 'client') { if (!clientIds.includes(r.client_id)) return false }
      else if (!(clientIds.includes(r.client_id) || assigned!(r))) return false
    }
    if (user.role === 'scheduler' && !(SCHEDULER_STATUSES.includes(r.status as ItemStatus) || r.owner_id === user.id)) return false
    if (statusFilter && r.status !== statusFilter) return false
    if (batchFilter && r.batch_id !== batchFilter) return false
    return true
  },
  orderBy: [['updated_at', 'desc']],
  limit: 500,
})
rows = await attachOne(rows, 'client_id', 'clients', ['name', 'timezone'])
rows = await attachOne(rows, 'batch_id', 'batches', ['title', 'status', 'planned_deliverables'])
rows = await attachOne(rows, 'work_kind_id', 'work_kinds', ['name', 'slug', 'color', 'uses_media'])
```
(Check the real foreign-key column names in the file; `work_kind_id` is an assumption to verify.)

- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep "app/api/production"` → empty. Rewrite `tests/version-slides-route.test.ts` per Task 9; `npx vitest run tests/version-slides-route.test.ts` → PASS.
- [ ] **Step 3: Commit** `git commit -am "refactor(db): production API on Realtime Database"`

---

### Task 13: Rewrite `app/api` group B — team, clients, portal, overview, leads, social (33 routes)

**Files:** `app/api/team/**` (13), `app/api/clients/**` (5), `app/api/website/clients/**` (6), `app/api/portal/**` (3), `app/api/overview/**` (2), `app/api/leads/**` (3), `app/api/social/**` (8 incl. `accounts/[id]`), `app/api/reports/leads/route.ts`, `app/api/audience/route.ts`

- [ ] **Step 1:** Wrap + recipe. `app/api/team/route.ts` and `team/[id]` create/update `team_users`: `email` uniqueness now throws `DbError('unique')` — map it to the existing 409 response text.
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep -E "app/api/(team|clients|website/clients|portal|overview|leads|social|reports|audience)"` → empty. Rewrite `tests/portal-plan-note-route.test.ts`, `tests/zernio-webhook-route.test.ts`, `tests/brand-profile-route.test.ts` (route half) per Task 9 → PASS.
- [ ] **Step 3: Commit** `git commit -am "refactor(db): team, client, portal, overview, leads and social APIs on Realtime Database"`

---

### Task 14: Rewrite the remaining routes, pages and Inngest functions (28 files)

**Files:** `app/api/asana/webhook/route.ts`, `app/api/assistant/prefs/route.ts`, `app/api/booking/**` (5), `app/api/db-tables/route.ts`, `app/api/ingest/**` (2), `app/api/intake/[token]/submit/route.ts`, `app/api/intake-templates/route.ts`, `app/api/monthly/[token]/submit/route.ts`, `app/api/room-invite/route.ts`, `app/api/submit/route.ts`, `app/api/subscribe/route.ts`, `app/api/website/journal/**` (2), `app/api/website/projects/**` (2), `app/api/website/seed/route.ts`, `app/api/website/upload/route.ts`, `app/monthly/[token]/page.tsx`, `app/intake/[token]/page.tsx`, `app/inngest/functions.ts`

Special cases:
- `app/api/db-tables/route.ts`: body becomes `return NextResponse.json({ tables: await listTables() })` with the same auth guard.
- `app/api/website/upload/route.ts`: remove the Supabase Storage branch; when `!r2Configured()` respond 503 `{ error: 'File storage is not configured' }`.
- `app/inngest/functions.ts`: wrap each function body in `withRequestCache`.
- `app/api/booking/stripe/webhook/route.ts`: `bookings.checkout_ref` unique index → check-then-insert; keep the idempotent 200 on a repeat.

- [ ] **Step 1:** Wrap + recipe. `grep -rl "lib/supabase" app lib components middleware.ts` → nothing.
- [ ] **Step 2:** `npx tsc --noEmit` → fully clean. `npm test` → all pass.
- [ ] **Step 3: Commit** `git commit -am "refactor(db): remaining routes, portal pages and Inngest functions on Realtime Database"`

---

### Task 15: Hot screens read live from the database

**Files:**
- Modify: `app/dashboard/page.tsx` (overview), `app/dashboard/production/page.tsx`, `app/dashboard/editor/page.tsx`, `app/dashboard/scheduler/page.tsx`, `app/dashboard/production/[id]/page.tsx`, `app/components/comments/CommentsDrawer.tsx`, `app/dashboard/leads/page.tsx`
- Create: `app/lib/scope-client.ts` (re-exports the pure scoping from `production-access` core for browser use — the file must not import `server-only` or `@/lib/db`; if `production-access.ts` mixes pure logic with data access, split the pure part into `app/lib/production-access-core.ts` first and re-export it from both)
- Test: `tests/scope-client.test.ts`

**Interfaces:**
- Consumes: `useTable`, `useRow`, `useLive` (Task 6); `/api/team/me` for the viewer's role and id (already exists).
- Produces: `visibleItems(viewer: { id; role }, items: ContentItem[], assignments: TeamUserClient[]): ContentItem[]` — pure, identical result to the server's `items` GET scoping (same predicate as Task 12).

- [ ] **Step 1: Write the failing test**

```ts
// tests/scope-client.test.ts
import { describe, it, expect } from 'vitest'
import { visibleItems } from '@/app/lib/scope-client'

const items: any[] = [
  { id: 'i1', client_id: 'c1', status: 'draft', owner_id: 'u2', scheduler_ids: [] },
  { id: 'i2', client_id: 'c2', status: 'approved', owner_id: 'u9', scheduler_ids: ['u1'] },
  { id: 'i3', client_id: 'c3', status: 'draft', owner_id: 'u9', scheduler_ids: [] },
]
describe('visibleItems', () => {
  it('super admin sees everything', () => {
    expect(visibleItems({ id: 'u1', role: 'super_admin' }, items, []).map(i => i.id)).toEqual(['i1', 'i2', 'i3'])
  })
  it('an editor sees assigned clients plus items handed to them', () => {
    const out = visibleItems({ id: 'u1', role: 'editor' }, items, [{ id: 'u1__c1', team_user_id: 'u1', client_id: 'c1' } as any])
    expect(out.map(i => i.id)).toEqual(['i1', 'i2'])
  })
  it('a scheduler sees scheduler statuses or their own', () => {
    const out = visibleItems({ id: 'u1', role: 'scheduler' }, items, [])
    expect(out.map(i => i.id)).toEqual(['i2'])
  })
})
```

Adjust the expected role names and statuses to the real constants in `app/lib/workflow-core.ts` and the real predicate in `production-access` before running — the test pins parity with the server, so copy the server's rules, do not invent new ones.

- [ ] **Step 2:** Run → FAIL (module missing). Implement `app/lib/scope-client.ts` by importing the pure predicate builders from `production-access-core` and applying them.
- [ ] **Step 3:** Rewrite `app/dashboard/production/page.tsx`: replace the four `fetch('/api/production/…')` reads in `load()` with `useTable<ContentItem>('content_items')`, `useTable<Batch>('batches')`, `useTable<DeliverableGroup>('deliverable_groups')`, `useTable<Client>('clients')`, `useTable<TeamUserClient>('team_user_clients')`, then `visibleItems(me, items, assignments)` in a `useMemo`. Keep every write (`PATCH`, `DELETE`, move) as the existing `fetch` calls. Remove `useProductionLive` from this page — the listeners already re-render. Keep `/api/team/me` for the viewer.
- [ ] **Step 4:** Same shape for `editor/page.tsx`, `scheduler/page.tsx` (+ `ScheduleCalendar.tsx` receives rows as props), `dashboard/page.tsx` overview cards (counts computed from the live rows with the same pure helpers the `/api/overview` route uses — move those to a `*-core.ts` if they are inline), `production/[id]/page.tsx` (`useRow('content_items', id)` + `useTable('asset_versions', { by: { item_id: id } })`), `CommentsDrawer.tsx` (`useTable('item_comments', { by: { item_id } })` / `batch_comments`), `leads/page.tsx` (`useTable('leads', { orderBy: [['created_at','desc']] })`).
- [ ] **Step 5:** `npx tsc --noEmit`, `npm test`, `npm run build` → all clean. Manual check: `npm run dev`, open `/dashboard/production` in two tabs, move an item in one, the other updates without reload.
- [ ] **Step 6: Commit** `git commit -am "feat(dashboard): boards, item page, comments and leads render live from Realtime Database"`

---

### Task 16: Remove Supabase, update docs, deploy env

**Files:**
- Delete: `lib/supabase.ts`, `supabase/` (whole directory), `app/inngest/channels.ts` if still present
- Modify: `package.json` (remove `@supabase/supabase-js`), `.env.local` (remove `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), `CLAUDE.md`, `docs/PROJECT_STATE.md`, `scripts/gen-db-types.mjs` header comment (now reads from git history: `git show HEAD~1:supabase/...`; simpler — copy `supabase/*.sql` to `docs/schema-history/` before deleting so the generator keeps working; do that)
- Test: `tests/plain-words.test.ts` still passes

- [ ] **Step 1:** `git mv supabase docs/schema-history` and point `SQL_DIR` in `scripts/gen-db-types.mjs` at it. `npm uninstall @supabase/supabase-js`. `git rm lib/supabase.ts`. Remove the two env vars from `.env.local`.
- [ ] **Step 2:** `CLAUDE.md`: Stack row `Data | Firebase Realtime Database under /mdm — server via REST (lib/db.ts), browser live via firebase/database (lib/db-client.ts)`. Trap 7 becomes: "`lib/firebase-config.ts` reads env lazily; `NEXT_PUBLIC_FIREBASE_DATABASE_URL` missing fails the request, not the build." Add trap 9: "RTDB keys cannot contain `. # $ [ ] /` — use `encodeKey()` for any natural key." Add trap 10: "No `firebase-admin`. Server access is the REST API; open rules are the owner's decision."
- [ ] **Step 3:** `docs/PROJECT_STATE.md`: add a top section "Firebase Realtime Database — 3 Sep" (what moved, the `/mdm` layout, that `scan_runs` and `asana_events` started fresh, the Supabase export location, the Vercel env vars to set). Replace every "run `supabase/x.sql` in the SQL editor" instruction with "no SQL step: tables are created on first write".
- [ ] **Step 4:** `grep -rni supabase app lib components tests scripts docs/PROJECT_STATE.md CLAUDE.md --include=*.ts --include=*.tsx --include=*.md --include=*.mjs | grep -v schema-history | grep -v superpowers` → only the historical mentions in PROJECT_STATE's dated sections and the plain-words test's copy guard.
- [ ] **Step 5:** `npm test`, `npx tsc --noEmit`, `npm run build` → all pass.
- [ ] **Step 6:** Vercel: `npx vercel env add NEXT_PUBLIC_FIREBASE_API_KEY production` (and preview) for the five vars; `npx vercel env rm NEXT_PUBLIC_SUPABASE_URL production` and `SUPABASE_SERVICE_ROLE_KEY`. If the CLI is not logged in, list the exact five names and values (except none are secret) in the final report for the owner to paste.
- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove Supabase; Firebase Realtime Database is the only data store"
```

---

## Self-review

**Spec coverage.** Data layout → Tasks 2, 4, 7. Access layer server → Task 4, joins → 5, browser → 6. Realtime markers → 5, 8. Hot screens → 15. Migration with verification and dry run → 7. Cleanup (supabase dir, package, env, storage fallback, db-tables, docs) → 11, 14, 16. Testing (db, join, fake, 13 rewritten tests, plain-words) → 3, 4, 5, 9–14. Out-of-scope items untouched.

**Placeholders.** None: every step has code or an exact command. Two spots ask the implementer to verify a name against the real file (`work_kind_id`, role constants); that is verification, not deferral.

**Type consistency.** `table<T>(name)`, `list({ by, where, orderBy, limit })`, `attachOne(rows, fk, target, cols, as?)`, `announce(channel, hint)`, `useLive(channel, onChange, opts)`, `seedDb(seed)` are used with the same names and shapes in Tasks 4–15. `assignedItemsFilter` changes from string to predicate in Task 10 and its callers are updated in Task 12.
