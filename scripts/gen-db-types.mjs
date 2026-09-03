// Parses every `create table` in docs/schema-history/*.sql and writes
// lib/db-types.ts. Later `alter table … add column` statements are folded
// in. The SQL is history now — Postgres/Supabase is gone and RTDB tables are
// created on first write — but the column shapes it recorded are still the
// source these generated interfaces come from. Run:
//   node scripts/gen-db-types.mjs
import fs from 'node:fs'
import path from 'node:path'

const SQL_DIR = 'docs/schema-history'
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
  // Anything else unrecognised (e.g. a custom enum like item_status) is text
  // on the wire — only json/jsonb (handled above) should stay `unknown`.
  return 'string'
}
// json/jsonb columns need naming separately: the Realtime Database stores no
// empty object, so a column written as `{}` reads back missing. lib/db.ts and
// lib/db-client.ts put it back (null if nullable, else {}) using this list.
const isJson = pg => /^(jsonb|json)\b/i.test(pg.trim()) && !/\[\]\s*$/.test(pg)
// …and which of those held a JSON ARRAY (`default '[]'::jsonb`). Restoring one
// as `{}` would be worse than leaving it missing: `[...(row.docs ?? [])]`
// throws on a plain object, where it coped with undefined.
const isJsonArrayDefault = decl => /default\s*'\s*\[/i.test(decl)

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
      cols.set(col, { type: tsType(type.trim()), nullable, json: isJson(type), jsonArray: isJson(type) && isJsonArrayDefault(t) })
    }
    tables.set(name, cols)
  }
  for (const m of sql.matchAll(/alter table(?: if exists)?\s+(?:public\.)?([a-z_]+)\s+add column(?: if not exists)?\s+"?([a-z_]+)"?\s+([a-z_ \[\]]+(?:\([^)]*\))?)([^;]*);/gi)) {
    const [, name, col, type, rest] = m
    const cols = tables.get(name) ?? new Map()
    cols.set(col, { type: tsType(type.trim()), nullable: !/not null/i.test(rest), json: isJson(type), jsonArray: isJson(type) && isJsonArrayDefault(type + rest) })
    tables.set(name, cols)
  }
  for (const m of sql.matchAll(/create trigger\s+[a-z_]+_updated_at\s+before update on\s+(?:public\.)?([a-z_]+)/gi)) updatedAt.add(m[1])
}

// Tables the code queries but no SQL ever created.
//   website        — the CMS singleton node
//   claim_locks    — one row per "exactly one winner" rule that spans rows
//                    (id = `<rule>__<key>`), compare-and-set by lib/db.ts's
//                    claim(). Never migrated: it holds no history.
//   booking_seats  — one row per (space, seat) holding the time ranges that
//                    seat is spoken for, so no-overlap is one atomic write.
//   social_posts   — a PLANNED post: the composition (chosen slides, caption,
//                    channels, time) that has to exist BEFORE anything is
//                    queued, because it sits in final-post approval first.
//                    One post <-> one item; its approval IS the item's
//                    posting_approval_state, never a second state machine.
//   schedule_notes — a short note pinned to a day and time on the Schedule
//                    calendar. Team-only; it never reaches a client or a
//                    provider.
const col = (type, nullable, json = false, jsonArray = false) => ({ type, nullable, json, jsonArray })
const GHOST_TABLES = {
  website: [['id', col('string', false)]],
  claim_locks: [['id', col('string', false)]],
  booking_seats: [['id', col('string', false)]],
  social_posts: [
    ['id', col('string', false)],
    ['client_id', col('string', false)],
    ['item_id', col('string', false)],
    // a draft dragged onto the calendar before graphics are chosen has no
    // version yet; eligibility() is what refuses to SEND such a post
    ['version_id', col('string', true)],
    ['version_number', col('number', true)],
    ['slides', col('unknown', false, true, true)],
    ['caption', col('string', true)],
    ['per_channel', col('unknown', false, true, false)],
    ['channels', col('unknown', false, true, true)],
    ['scheduled_for', col('string', true)],
    ['timezone', col('string', false)],
    ['status', col('string', false)],
    ['publish_job_ids', col('unknown', false, true, true)],
    ['created_by', col('string', true)],
    ['created_at', col('string', false)],
    ['updated_at', col('string', false)],
    ['sent_at', col('string', true)],
    ['approved_at', col('string', true)],
    ['approved_by', col('string', true)],
    // 'client' = it went through the final-post approval; 'self' = an account
    // manager (or super admin) cleared it themselves at send time, which the
    // owner asked for on 3 Sep. Null on a post that has not been sent.
    ['approval_mode', col('string', true)],
    ['note', col('string', true)],
  ],
  schedule_notes: [
    ['id', col('string', false)],
    ['client_id', col('string', false)],
    ['at', col('string', false)],
    ['text', col('string', false)],
    ['created_by', col('string', true)],
    ['created_at', col('string', false)],
    ['updated_at', col('string', false)],
  ],
}
for (const [ghost, cols] of Object.entries(GHOST_TABLES)) {
  if (!tables.has(ghost)) tables.set(ghost, new Map(cols.map(([c, def]) => [c, { ...def }])))
}
// Ghost tables have no `create trigger` line to be read from, so the ones that
// carry updated_at say so here — lib/db.ts stamps the column from this set.
for (const ghost of ['social_posts', 'schedule_notes']) updatedAt.add(ghost)

// Columns the code writes but no SQL ever created.
//   notification_log.claimed_at — when a retrier last took the row. The stale
//     rule is "pending since more than 10 minutes ago", and created_at cannot
//     answer that once a row has been reclaimed: the winner's write does not
//     move it, so the next retrier would judge the row stale again and send
//     the same email twice. Staleness is judged on claimed_at ?? created_at.
//   clients.instagram_locations — the places this client tags posts at, as
//     [{ name, pageId }]. Instagram's location is a NUMERIC FACEBOOK PAGE ID
//     and neither the Graph API nor Zernio has a place search, so the ids
//     have to be looked up once by a person and kept; without this list every
//     scheduler would be retyping a 15-digit number from a Facebook page.
const GHOST_COLUMNS = {
  notification_log: [['claimed_at', { type: 'string', nullable: true }]],
  clients: [['instagram_locations', col('unknown', false, true, true)]],
}
for (const [t, cols] of Object.entries(GHOST_COLUMNS)) {
  const existing = tables.get(t)
  if (existing) for (const [c, def] of cols) if (!existing.has(c)) existing.set(c, def)
}
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
function singularizeWord(w) {
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (/(xes|ches|shes|sses)$/.test(w)) return w.slice(0, -2)
  if (/s$/.test(w) && !/(ss|us)$/.test(w)) return w.slice(0, -1)
  return w
}
const pascal = n => {
  const words = n.split('_')
  words[words.length - 1] = singularizeWord(words[words.length - 1])
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

const names = [...tables.keys()].sort()
let out = `// GENERATED by scripts/gen-db-types.mjs from docs/schema-history/*.sql — do not edit by hand.\n\n`
out += `export type Row = { id: string }\n\n`
out += `export type TableName =\n${names.map(n => `  | '${n}'`).join('\n')}\n\n`
for (const n of names) {
  out += `export interface ${pascal(n)} {\n`
  for (const [c, { type, nullable }] of tables.get(n)) out += `  ${c}: ${type}${nullable ? ' | null' : ''}\n`
  out += `}\n\n`
}
out += `export const TABLE_COLUMNS = {\n${names.map(n => `  ${n}: [${[...tables.get(n).keys()].map(c => `'${c}'`).join(', ')}],`).join('\n')}\n} as const satisfies Record<TableName, readonly string[]>\n\n`
out += `export const NULLABLE_COLUMNS = {\n${names.map(n => `  ${n}: [${[...tables.get(n)].filter(([, v]) => v.nullable).map(([c]) => `'${c}'`).join(', ')}],`).join('\n')}\n} as const satisfies Record<TableName, readonly string[]>\n\n`
out += `/**\n * json/jsonb columns. The Realtime Database stores no empty object or array, so\n * a column written as an empty object reads back missing; normalise() (lib/db.ts)\n * and snapshotToRows() (lib/db-client.ts) restore it — null when the column is\n * nullable, {} when it is not — or [] when the column is listed in\n * JSON_ARRAY_COLUMNS below.\n */\nexport const JSON_COLUMNS = {\n${names.map(n => `  ${n}: [${[...tables.get(n)].filter(([, v]) => v.json).map(([c]) => `'${c}'`).join(', ')}],`).join('\n')}\n} as const satisfies Record<TableName, readonly string[]>\n\n`
out += `/**\n * The subset of JSON_COLUMNS whose Postgres default was a JSON ARRAY\n * (default '[]'::jsonb). Restoring one of these as {} would be worse than\n * leaving it missing — spreading a plain object into an array throws, where\n * undefined was absorbed by the callers' \\u0060?? []\\u0060.\n */\nexport const JSON_ARRAY_COLUMNS = {\n${names.map(n => `  ${n}: [${[...tables.get(n)].filter(([, v]) => v.jsonArray).map(([c]) => `'${c}'`).join(', ')}],`).join('\n')}\n} as const satisfies Record<TableName, readonly string[]>\n\n`
out += `export const UPDATED_AT_TABLES: ReadonlySet<TableName> = new Set<TableName>([${[...updatedAt].sort().map(t => `'${t}'`).join(', ')}])\n\n`
out += `export function encodeKey(s: string): string {\n  return s.replace(/[.#$\\[\\]\\/%]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))\n}\n\n`
out += `/** Tables whose Postgres key was not a uuid \`id\`. The id stored in RTDB is derived from the row. */\nexport const NATURAL_KEYS: Partial<Record<TableName, (row: any) => string>> = {
  team_user_clients: r => \`\${r.team_user_id}__\${r.client_id}\`,
  user_page_access: r => \`\${r.team_user_id}__\${encodeKey(r.href)}\`,
  asset_versions: r => \`\${r.item_id}__\${r.version_number}\`,
  client_brand: r => r.client_id,
  drive_connection: () => 'team',
  scan_settings: () => 'singleton',
  intake_settings: () => 'singleton',
  assistant_prefs: r => r.clerk_user_id,
  intake_templates: r => encodeKey(r.key),
  scan_mailboxes: r => encodeKey(r.email),
  calendar_accounts: r => encodeKey(r.email),
  asana_project_map: r => r.project_gid,
  asana_tasks: r => r.gid,
  asana_webhooks: r => r.webhook_gid ?? r.id,
}\n`
fs.writeFileSync(OUT, out)
console.log(`wrote ${OUT}: ${names.length} tables`)
