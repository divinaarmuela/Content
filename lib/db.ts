import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { rtdbUrl } from './firebase-config'
import { INDEXED_COLUMNS } from './db-indexes'
import {
  NATURAL_KEYS, NULLABLE_COLUMNS, TABLE_COLUMNS, UPDATED_AT_TABLES, encodeKey,
  type Row, type TableName,
} from './db-types'

export { encodeKey, INDEXED_COLUMNS }

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
  code: 'unique' | 'network' | 'bad_request'
  constructor(code: DbError['code'], message: string) { super(message); this.code = code; this.name = 'DbError' }
}

export type ListQuery<T> = {
  by?: Partial<T>
  where?: (row: T) => boolean
  orderBy?: [keyof T & string, 'asc' | 'desc'][]
  limit?: number
  /**
   * Go to the network even inside a request cache, and replace what the cache
   * holds with the answer.
   *
   * For a guard that re-reads a row it has already read: without this the
   * second read resolves the SAME cached promise, so it can never observe a
   * concurrent change and the check is vacuous.
   */
  fresh?: boolean
}

// `T extends Row` (where Row is just `{ id: string }`) lets `table<Client>(...)`
// bind to a concrete generated interface and get real excess-property checks
// on writes (`update('i1', { titel: 'Z' })` fails to compile). The default
// type argument (`Row & Record<string, unknown>`) is what an untyped call —
// `table('clients')` — falls back to, so it stays as loose as before: a
// patch like `{ name: 'New' }` is still accepted with no explicit type
// argument to check it against.
export interface Table<T extends Row> {
  name: TableName
  get(id: string, opts?: { fresh?: boolean }): Promise<T | null>
  list(q?: ListQuery<T>): Promise<T[]>
  count(q?: ListQuery<T>): Promise<number>
  insert(row: Omit<T, 'id'> & { id?: string }): Promise<T>
  update(id: string, patch: Partial<T>): Promise<T | null>
  upsert(row: Partial<T> & { id?: string }, opts?: { onConflict?: keyof T & string }): Promise<T>
  remove(id: string): Promise<void>
  removeWhere(where: (row: T) => boolean): Promise<number>

  /**
   * Read a row together with its ETag, always from the network.
   *
   * The ETag is the row node's current version: hand it back to
   * compareAndSet and the write lands only if nothing has touched the row in
   * between. A missing row reads as `{ row: null, etag: NULL_ETAG }`, which
   * is a claimable state — CAS with it creates the row, and exactly one
   * creator can win.
   */
  getForUpdate(id: string): Promise<{ row: T | null; etag: string }>

  /**
   * Replace the row, but only if it is still at `etag`.
   *
   * Returns `{ ok: true, row }` on success and `{ ok: false, current, etag }`
   * when somebody wrote first — a lost race is an answer, never a throw.
   * Stamps `updated_at` on trigger tables and `created_at` on a row it
   * creates.
   *
   * CAS does NOT move unique columns. It owns one row node, while a unique
   * key lives in a second node under /mdm/uniq, and one conditional PUT
   * cannot cover both — so a value change there could only be applied
   * non-atomically, which is the very thing this method exists to remove.
   * It verifies instead: a unique value in `next` that another row already
   * claims throws DbError('unique'). Use insert()/update() to change one.
   */
  compareAndSet(id: string, etag: string, next: T): Promise<{ ok: true; row: T } | { ok: false; current: T | null; etag: string }>

  /**
   * Read → decide → conditionally write, retried on a lost race.
   *
   * `mutate` receives the row as it really is right now and returns the row
   * to write, or null to stand down (the seat is taken, the guard fails,
   * there is nothing to do). On a lost race the row is re-read and `mutate`
   * runs again on the newer version, up to `attempts` conditional writes.
   *
   * This is the shape every "exactly one winner" rule in this codebase takes:
   * one claimant leaves with `{ claimed: true }`, everyone else with
   * `{ claimed: false, current }` and the row that beat them.
   */
  claim(id: string, mutate: (current: T | null) => T | null, opts?: { attempts?: number }): Promise<{ claimed: true; row: T } | { claimed: false; current: T | null }>
}

/** The ETag of a node that does not exist. Claiming with it creates the row. */
export const NULL_ETAG = 'null_etag'

/**
 * Single-column UNIQUE constraints carried over from Postgres.
 *
 * Verified against supabase/*.sql (grep -rniE "unique"), across two review
 * rounds. Every column below really is enforced as a standalone unique
 * constraint or unique index (or is the table's primary key). Entries the
 * migration brief or a later review listed that did not hold up were
 * intentionally left out:
 *   - team_invites.email: only a PARTIAL unique index on lower(email) WHERE
 *     status = 'pending' (identity.sql) — accepted/revoked invites may repeat
 *     an email, so a plain always-on unique key would reject legitimate rows.
 *   - webhook_deliveries.provider_event_id: the unique index is composite,
 *     on (provider, provider_event_id) (webhook_deliveries.sql). A JSON tree
 *     indexes one field, so the PAIR is carried as a derived column,
 *     `provider_event_key`, which is declared below and does hold.
 *   - publish_jobs.dedupe_key: no such column exists on publish_jobs
 *     (social_publishing.sql); the only unique index there is partial, on
 *     content_item_id.
 * Corrected to match the actual schema:
 *   - notification_log: the real column is `dedupe_key` (identity.sql), not
 *     `dedup_key`.
 *   - social_accounts: the real unique column is `provider_account_id`
 *     (social_publishing.sql), not `provider_post_id`.
 * Added in the round-1 fix review, each re-verified against its .sql file:
 *   asana_events.dedup_key (asana_activity.sql, not null unique), clients.slug
 *   (website_cms.sql, not null unique — alongside the existing share_token),
 *   journal_posts.slug (journal.sql), booking_services.slug (booking.sql),
 *   shoot_proposals.token (shoot_proposals.sql), room_invite_requests.email
 *   (room_invites.sql), client_agreements.client_id (agreements_and_briefs.sql
 *   — a standalone `unique` on the column, not a primary key, so it still
 *   needs a /mdm/uniq claim), content_assets.slug and .provider_post_id, and
 *   asset_clicks.click_id (both content_register.sql).
 */
export const UNIQUE_COLUMNS: Partial<Record<TableName, readonly string[]>> = {
  team_users: ['email', 'clerk_user_id'],
  newsletter_subscribers: ['email'],
  video_previews: ['source_url'],
  email_ingest_log: ['gmail_message_id'],
  post_analytics: ['provider_post_id'],
  notification_log: ['dedupe_key'],
  asana_project_map: ['project_gid'],
  asana_events: ['dedup_key'],
  work_kinds: ['slug'],
  projects: ['slug'],
  intake_forms: ['token'],
  monthly_updates: ['token'],
  clients: ['share_token', 'slug'],
  client_brand: ['client_id'],
  social_accounts: ['provider_account_id'],
  journal_posts: ['slug'],
  booking_services: ['slug'],
  shoot_proposals: ['token'],
  room_invite_requests: ['email'],
  client_agreements: ['client_id'],
  content_assets: ['slug', 'provider_post_id'],
  asset_clicks: ['click_id'],
  // derived: the pair (provider, provider_event_id), which Postgres held as a
  // composite unique index. See app/lib/zernio-events.ts providerEventKey.
  webhook_deliveries: ['provider_event_key'],
}

/**
 * Columns `database.rules.json` declares `.indexOn` for, mirrored exactly.
 * RTDB's REST API rejects an orderBy/equalTo query on any other field with a
 * 400 ("Index not defined") — pushing an arbitrary `by` key down as a query
 * would work against the fake in tests and break in production the moment a
 * real database enforces its rules. `readAll` below only pushes an
 * indexed key down; everything else is filtered in memory after a full read.
 *
 * Defined in `lib/db-indexes.ts` (which imports nothing, including no
 * `server-only`) so the browser module `lib/db-client.ts` can import the
 * same set without pulling in this server-only module; re-exported here
 * (see the import above) so existing callers of `lib/db.ts` don't change.
 */

const ROOT = '/mdm'

// ---- transport ------------------------------------------------------------

export async function rtdbFetch(path: string, init: RequestInit & { query?: Record<string, string>; table?: string } = {}): Promise<any> {
  const { query, table: tableCtx, ...rest } = init
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  const url = `${rtdbUrl()}${path}.json${qs}`
  let res: Response
  try {
    res = await fetch(url, { ...rest, headers: { 'content-type': 'application/json', ...(rest.headers ?? {}) }, cache: 'no-store' })
  } catch (e) {
    throw new DbError('network', `Database unreachable: ${(e as Error).message}`)
  }
  if (!res.ok) {
    // The RTDB security rules make a losing unique-claim PATCH fail at the
    // database itself (belt to the pre-check's suspenders — see uniqChecks).
    // A write rejected by rules comes back 401/403, never a GET.
    const isWrite = !!rest.method && rest.method.toUpperCase() !== 'GET'
    if (isWrite && (res.status === 401 || res.status === 403)) {
      throw new DbError('unique', tableCtx ? `${tableCtx} unique key already taken` : 'unique key already taken')
    }
    throw new DbError(res.status === 400 ? 'bad_request' : 'network', `Database ${rest.method ?? 'GET'} ${path} failed (${res.status})`)
  }
  return res.json()
}

/**
 * GET a node and its ETag.
 *
 * The REST API only sends the header when the request asks for it, so the
 * ask is the whole difference between this and rtdbFetch.
 */
async function rtdbGetWithEtag(path: string): Promise<{ value: any; etag: string }> {
  const url = `${rtdbUrl()}${path}.json`
  let res: Response
  try {
    res = await fetch(url, { headers: { 'content-type': 'application/json', 'X-Firebase-ETag': 'true' }, cache: 'no-store' })
  } catch (e) {
    throw new DbError('network', `Database unreachable: ${(e as Error).message}`)
  }
  if (!res.ok) throw new DbError(res.status === 400 ? 'bad_request' : 'network', `Database GET ${path} failed (${res.status})`)
  return { value: await res.json(), etag: res.headers.get('ETag') ?? NULL_ETAG }
}

/**
 * PUT a node only if it is still at `etag`.
 *
 * 412 is not a failure: it is the database answering "somebody else got here
 * first", with the value that beat us and the tag to retry against. Every
 * other non-2xx is still an error.
 */
async function rtdbPutIfMatch(
  path: string, etag: string, body: unknown,
): Promise<{ ok: true } | { ok: false; current: any; etag: string }> {
  const url = `${rtdbUrl()}${path}.json`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': etag },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (e) {
    throw new DbError('network', `Database unreachable: ${(e as Error).message}`)
  }
  if (res.status === 412) {
    return { ok: false, current: await res.json().catch(() => null), etag: res.headers.get('ETag') ?? NULL_ETAG }
  }
  if (!res.ok) throw new DbError(res.status === 400 ? 'bad_request' : 'network', `Database PUT ${path} failed (${res.status})`)
  return { ok: true }
}

// ---- request cache ----------------------------------------------------------

const als = new AsyncLocalStorage<Map<string, Promise<any>>>()

/** Run `fn` with a read cache: identical GETs inside it hit the network once. Writes invalidate the table. */
export function withRequestCache<R>(fn: () => Promise<R>): Promise<R> {
  return als.run(new Map(), fn)
}
function cachedGet(path: string, query?: Record<string, string>, fresh = false): Promise<any> {
  const store = als.getStore()
  const key = path + (query ? '?' + new URLSearchParams(query).toString() : '')
  if (!store) return rtdbFetch(path, { query })
  if (fresh) {
    // the fresh answer becomes the cached one: a guard that re-read the row is
    // the most current thing this request knows about it
    const p = rtdbFetch(path, { query })
    store.set(key, p)
    return p
  }
  let p = store.get(key)
  if (!p) { p = rtdbFetch(path, { query }); store.set(key, p) }
  return p
}
function invalidate(name: string) {
  const store = als.getStore()
  if (!store) return
  const tablesPrefix = `${ROOT}/tables/${name}`
  const uniqPrefix = `${ROOT}/uniq/${name}`
  const hits = (k: string, p: string) => k === p || k.startsWith(`${p}/`) || k.startsWith(`${p}?`)
  for (const k of [...store.keys()]) if (hits(k, tablesPrefix) || hits(k, uniqPrefix)) store.delete(k)
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

export function table<T extends Row = Row & Record<string, unknown>>(name: TableName): Table<T> {
  const base = `${ROOT}/tables/${name}`
  const uniques = UNIQUE_COLUMNS[name] ?? []
  const naturalKey = NATURAL_KEYS[name]

  async function readAll(by?: Partial<T>, fresh = false): Promise<T[]> {
    let node: any
    let rest: Partial<T> = by ?? {}
    if (by && Object.keys(by).length) {
      const entries = Object.entries(by)
      // Push down the FIRST `by` key that database.rules.json actually
      // indexes; everything else — including an indexed key whose value is
      // null, which equalTo can't usefully express — is filtered in memory
      // after reading the whole node.
      const idx = entries.findIndex(([k, v]) => v != null && INDEXED_COLUMNS.has(k))
      if (idx >= 0) {
        const [col, val] = entries[idx]
        rest = Object.fromEntries(entries.filter((_, i) => i !== idx)) as Partial<T>
        node = await cachedGet(base, { orderBy: JSON.stringify(col), equalTo: JSON.stringify(val) }, fresh)
      } else {
        node = await cachedGet(base, undefined, fresh)
      }
    } else {
      node = await cachedGet(base, undefined, fresh)
    }
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
    async get(id, opts) {
      // If the whole table is already cached for this request (a prior
      // list()/count() with no `by`), serve from it instead of a fresh GET —
      // that is the "touches the same table five times, pays once" contract.
      // `fresh` opts out: a guard re-reading a row it already read must see
      // the network, not its own earlier answer.
      const store = als.getStore()
      // a fresh read also drops the whole-table entry, so a later list() in
      // this request cannot serve the version we have just proved stale
      if (opts?.fresh) store?.delete(base)
      const wholeTable = opts?.fresh ? undefined : store?.get(base)
      if (wholeTable) {
        const node = await wholeTable
        return node?.[id] ? normalise<T>(name, id, node[id]) : null
      }
      const raw = await cachedGet(`${base}/${id}`, undefined, opts?.fresh)
      return raw ? normalise<T>(name, id, raw) : null
    },
    async list(q = {}) {
      let rows = await readAll(q.by, q.fresh)
      if (q.where) rows = rows.filter(q.where)
      rows = sortRows(rows, q.orderBy)
      if (q.limit != null) rows = rows.slice(0, q.limit)
      return rows
    },
    async count(q = {}) {
      let rows = await readAll(q.by, q.fresh)
      if (q.where) rows = rows.filter(q.where)
      return rows.length
    },
    async insert(input) {
      const id = idFor(name, input)
      // A natural-key table's id is derived from its own data (e.g.
      // client_brand's id IS client_id), so a second insert for the same key
      // would silently overwrite the first row's PATCH instead of failing
      // like a real primary-key violation would.
      if (naturalKey) {
        const existing = await cachedGet(`${base}/${id}`)
        if (existing) throw new DbError('unique', `${name} row already exists`)
      }
      const now = new Date().toISOString()
      const hasCreatedAt = (TABLE_COLUMNS[name] as readonly string[]).includes('created_at')
      const row: any = stripNulls({ ...(hasCreatedAt ? { created_at: now } : {}), ...(input as any), id })
      if (UPDATED_AT_TABLES.has(name)) row.updated_at = row.updated_at ?? now
      const patch: Record<string, unknown> = { [`tables/${name}/${id}`]: row, ...(await uniqChecks(row, id)) }
      await rtdbFetch(ROOT, { method: 'PATCH', body: JSON.stringify(patch), table: name })
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
      await rtdbFetch(ROOT, { method: 'PATCH', body: JSON.stringify(body), table: name })
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
      } else if (naturalKey) {
        const derivedId = naturalKey(row)
        const existing = await t.get(derivedId)
        if (existing) return (await t.update(derivedId, row)) as T
      }
      return t.insert(row as any)
    },
    async remove(id) {
      const current = await cachedGet(`${base}/${id}`)
      const body: Record<string, unknown> = { [`tables/${name}/${id}`]: null, ...uniqClears(current) }
      await rtdbFetch(ROOT, { method: 'PATCH', body: JSON.stringify(body), table: name })
      invalidate(name)
    },
    async getForUpdate(id) {
      const { value, etag } = await rtdbGetWithEtag(`${base}/${id}`)
      // like get({ fresh: true }): what the network just said replaces both
      // the row's own cache entry and any whole-table copy this request holds
      const store = als.getStore()
      if (store) { store.delete(base); store.set(`${base}/${id}`, Promise.resolve(value)) }
      return { row: value ? normalise<T>(name, id, value) : null, etag }
    },
    async compareAndSet(id, etag, next) {
      // CAS cannot move a unique key (see the interface doc) — but it can and
      // must refuse to write a value another row already owns, so a misuse
      // fails loudly here instead of quietly forking the key.
      for (const col of uniques) {
        const v = (next as any)[col]
        if (v == null) continue
        const owner = await cachedGet(`${ROOT}/uniq/${name}/${col}/${encodeKey(String(v))}`)
        if (owner && owner !== id) throw new DbError('unique', `${name}.${col} already exists`)
      }
      const now = new Date().toISOString()
      const row: any = { ...(next as any), id }
      const hasCreatedAt = (TABLE_COLUMNS[name] as readonly string[]).includes('created_at')
      if (hasCreatedAt && row.created_at == null) row.created_at = now
      if (UPDATED_AT_TABLES.has(name)) row.updated_at = now
      const body = stripNulls(row)
      const res = await rtdbPutIfMatch(`${base}/${id}`, etag, body)
      invalidate(name)
      if (res.ok) return { ok: true, row: normalise<T>(name, id, body) }
      return { ok: false, current: res.current ? normalise<T>(name, id, res.current) : null, etag: res.etag }
    },
    async claim(id, mutate, opts) {
      const attempts = Math.max(1, opts?.attempts ?? 3)
      let { row: current, etag } = await t.getForUpdate(id)
      for (let i = 0; i < attempts; i++) {
        const next = mutate(current)
        if (next === null) return { claimed: false, current }
        const res = await t.compareAndSet(id, etag, next)
        if (res.ok) return { claimed: true, row: res.row }
        // the 412 carried the row that beat us and a usable tag, so the retry
        // decides again on real current state without a second read
        current = res.current
        etag = res.etag
      }
      return { claimed: false, current }
    },
    async removeWhere(where) {
      const rows = (await readAll()).filter(where)
      if (!rows.length) return 0
      const body: Record<string, unknown> = {}
      for (const r of rows) { body[`tables/${name}/${r.id}`] = null; Object.assign(body, uniqClears(r)) }
      await rtdbFetch(ROOT, { method: 'PATCH', body: JSON.stringify(body), table: name })
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
