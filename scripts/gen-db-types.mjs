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
  // drive_uploads — one in-flight upload started by a person on the Files
  //   page. The bytes are on somebody's laptop, so they arrive a slice at a
  //   time and each slice is a separate request; something has to remember the
  //   Google resumable session URI between them. It is kept HERE, on the
  //   server, and never handed to the browser: the browser holds `id` and
  //   nothing else, so a session cannot be replayed by anyone who is not
  //   signed in. The row is finished (or abandoned) the moment Drive returns a
  //   file id, and carries no bytes of its own.
  drive_uploads: [
    ['id', col('string', false)],
    ['upload_uri', col('string', false)],
    ['name', col('string', false)],
    ['parent_id', col('string', false)],
    ['mime_type', col('string', true)],
    ['size', col('number', true)],
    ['received', col('number', false)],
    ['client_id', col('string', true)],
    ['status', col('string', false)],       // open | done | failed
    ['drive_file_id', col('string', true)],
    ['created_by', col('string', true)],
    ['created_at', col('string', false)],
    ['updated_at', col('string', false)],
  ],
  // encode_jobs — one request to the encoder (services/encoder) for a
  //   publish-grade copy of one video, for one channel. It exists so that
  //   "is a clean copy of this file being made?" has ONE answer that survives
  //   a deploy, a retry and a second person opening the composer: the row is
  //   claimed on `source_url + platform`, so two asks for the same copy are
  //   one encode, and a publish job waiting on a copy waits on this row
  //   rather than on a poll. `output_key` is the R2 key the finished copy was
  //   PUT to — the public URL is that key under the bucket's public base, so
  //   the URL is never stored twice and can never disagree with itself.
  encode_jobs: [
    ['id', col('string', false)],
    ['source_url', col('string', false)],
    ['platform', col('string', false)],
    // what the channel is posting this AS — reel, story, feed. Kept on the row
    // because a retry has to make the same copy the first ask asked for: a
    // sweep that re-asked with the kind forgotten silently rebuilt a measured
    // 10 Mbps job at the 2 Mbps blind fallback, while `target_source` still
    // said 'measured'.
    ['kind', col('string', true)],
    // where the video came from, when it came from a piece of work. All three
    // are null for a copy asked for straight off a URL in the composer.
    ['asset_id', col('string', true)],
    ['version_id', col('string', true)],
    ['slide_index', col('number', true)],
    ['status', col('string', false)],       // queued | running | done | failed
    // how many times the encoder has been ASKED for this copy. The stale
    // sweep re-asks up to three times before settling the row failed, so a
    // transient blip — an R2 500, a download that timed out on a slow
    // morning — does not permanently poison every future post of that clip.
    ['attempts', col('number', false)],
    // the R2 key the copy is written to, chosen and stored BEFORE the encoder
    // is told anything and never changed afterwards. A retry re-signs the
    // SAME key: a row whose key names an object nothing ever wrote reads back
    // as `ready` with a URL that 404s, which the publish job then attaches to
    // a client's post.
    ['output_key', col('string', true)],
    // 'measured' when the clip's real length shaped the bitrate, 'fallback'
    // when nobody knew it and the channel's whole length ceiling had to be
    // budgeted for instead — which costs most of the quality this service
    // exists to buy. Visible on the row so the gap can be found rather than
    // guessed at.
    ['target_source', col('string', false)],
    ['bytes', col('number', true)],
    ['width', col('number', true)],
    ['height', col('number', true)],
    // how long the clip runs. Written at claim time when anything measured it
    // — it is what the bitrate was budgeted for, and what a retry must budget
    // for again — and confirmed by the callback with what ffprobe actually saw.
    ['duration_sec', col('number', true)],
    ['video_kbps', col('number', true)],
    ['error', col('string', true)],
    ['created_at', col('string', false)],
    ['updated_at', col('string', false)],
  ],
}
for (const [ghost, cols] of Object.entries(GHOST_TABLES)) {
  if (!tables.has(ghost)) tables.set(ghost, new Map(cols.map(([c, def]) => [c, { ...def }])))
}
// Ghost tables have no `create trigger` line to be read from, so the ones that
// carry updated_at say so here — lib/db.ts stamps the column from this set.
for (const ghost of ['social_posts', 'schedule_notes', 'drive_uploads', 'encode_jobs']) updatedAt.add(ghost)

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
//   NOTE on the client's provider group: the Schedule access page maps a
//     client to ONE group of accounts at the posting service (Zernio calls a
//     group a "profile" — not an Instagram profile but a folder several
//     connected accounts sit in; the owner keeps four). That mapping is
//     `clients.social_profile_id`, which ALREADY exists and is what the
//     connect flow, the automations route and the webhook matcher all read. A
//     second column meaning the same thing would be two answers to "which
//     group does this client post from", and posts would start coming out of
//     whichever one the reader happened to consult. So the access page writes
//     that column and no new one was added.
//   asset_versions.cover_url / trim_start / trim_end — what the image editor
//     saves for a VIDEO. Neither touches the file: a video is never
//     re-encoded in the browser (we would be handing the client a worse copy
//     of their own footage), so the cover is a still taken out of the already
//     approved clip and the trim marks are an instruction that travels with
//     the post. Because the file is unchanged, the client's approval stands.
const GHOST_COLUMNS = {
  notification_log: [['claimed_at', { type: 'string', nullable: true }]],
  clients: [
    ['instagram_locations', col('unknown', false, true, true)],
    ['drive_folder_id', col('string', true)],
    //   clients.drive_folder_origin — 'app' if this app made the folder,
    //     'adopted' if it was already in the owner's Drive and was matched to
    //     the client in Settings. It decides one thing: whether the app may
    //     change PERMISSIONS on the folder. An adopted folder is the owner's,
    //     shared however they chose to share it years ago, and a domain grant
    //     the app added "helpfully" is a change to someone else's filing that
    //     nobody asked for and nothing undoes.
    ['drive_folder_origin', col('string', true)],
  ],
  //   drive_connection.root_* — WHERE the filing cabinet is.
  //     The app can only see folders it made itself (the drive.file scope), so
  //     the owner's existing "MD Media HQ" folder is unreachable until a person
  //     hands it over through the Google Picker. That hand-over is what these
  //     columns record: root_folder_id/root_folder_name/root_owner_email are the
  //     PICKED folder, root_picked says a person chose it (so nothing ever
  //     creates a stray "Clients" folder in My Drive again), and
  //     clients_folder_id is the "Clients" subfolder inside it that every client
  //     folder hangs off.
  drive_connection: [
    ['root_folder_name', col('string', true)],
    ['root_owner_email', col('string', true)],
    //   root_origin — 'app' (the app made its own Clients folder, the original
    //     behaviour) or 'picked' (a person handed the app the agency's real HQ
    //     folder through the Google Picker). Everything that could CHANGE
    //     somebody else's Drive reads this first: on a picked root the app adds
    //     files and folders and does nothing else — no domain sharing, no
    //     member sync, and above all no permission removals. The owner manages
    //     who can see HQ, and the app is a guest there.
    ['root_origin', col('string', true)],
    ['root_picked_at', col('string', true)],
    ['root_picked_by', col('string', true)],
    ['clients_folder_id', col('string', true)],
    // set when a reconnect brought a DIFFERENT Google account than the one the
    // folder was chosen with. `drive.file` grants are per app AND per account,
    // so the picked folder is unreadable until somebody picks it again — and
    // nothing else would say so.
    ['root_account_changed', col('boolean', true)],
  ],
  //   asset_versions.source / source_drive_file_id — WHERE the files on this
  //     version came from. 'drive' means somebody picked them in the
  //     composer's Google Drive tab, so the originals are already in the
  //     agency's Drive and must never be copied back into it (the owner's
  //     ruling: no automatic filing, and a picker is not a round trip).
  //     `source_drive_file_id` is the Drive file the version was built from,
  //     so the piece can point back at the original rather than only at our
  //     copy of it; the per-slide ids live on `files`. Both nullable: an
  //     ordinary upload has neither, and so does every version written before
  //     the picker existed.
  asset_versions: [
    ['cover_url', col('string', true)],
    ['trim_start', col('number', true)],
    ['trim_end', col('number', true)],
    ['source', col('string', true)],
    ['source_drive_file_id', col('string', true)],
  ],
  //   drive_files.parent_id / name / uploaded_by / moved_at — what the Files
  //     page needs the mirror to remember. The table was written for "this
  //     source URL has been copied to this target", which never had to know
  //     WHERE in Drive the copy ended up: the target implied the folder. The
  //     Files page can move a file to any folder a person chooses, so the
  //     folder became a fact of its own — without it the page and the mirror
  //     would disagree about where a file is the moment somebody dragged one.
  //     `name` is kept for the same reason (a renamed file is still the same
  //     row), and `uploaded_by` answers "who put this here", which is the
  //     first thing anybody asks about a file they did not expect.
  drive_files: [
    ['parent_id', col('string', true)],
    ['name', col('string', true)],
    ['uploaded_by', col('string', true)],
    ['moved_at', col('string', true)],
  ],
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
