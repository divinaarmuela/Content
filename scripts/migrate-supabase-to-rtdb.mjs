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
// database.rules.json grants `.write` on mdm/tables, mdm/live and mdm/meta
// individually — there is no `.write` at /mdm or at /mdm/uniq itself (a
// descendant's conditional rule never authorises a shallower write). So the
// uniq pointers must go up as a multi-location PATCH at /mdm using the flat
// "uniq/<table>/<field>/<key>" paths already produced by buildUniq(), which
// RTDB validates per path against mdm/uniq/$table/$field/$key's own rule —
// never as a single PUT to /mdm/uniq, which would 401 with nothing applied.
async function patchChunked(flat, chunkSize = 500) {
  const keys = Object.keys(flat)
  for (let i = 0; i < keys.length; i += chunkSize) {
    const body = Object.fromEntries(keys.slice(i, i + chunkSize).map(k => [k, flat[k]]))
    await rt('/mdm', 'PATCH', body)
  }
}

const report = []
fs.mkdirSync(OUT_DIR, { recursive: true })
let uniqAll = {}
for (const t of TABLES) {
  const rows = await readTable(t)
  if (rows === null) {
    // Not created in Supabase (yet, or ever) — still PUT null on a real run
    // so a re-run after a table is dropped there can't leave stale rows
    // behind in RTDB from an earlier migration.
    if (!DRY) await rt(`/mdm/tables/${t}`, 'PUT', null)
    report.push([t, 'missing in Supabase', 0, '-'])
    continue
  }
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
  if (Object.keys(uniqAll).length) await patchChunked(Object.fromEntries(Object.entries(uniqAll).map(([k, v]) => [`uniq/${k}`, v])))
  await rt('/mdm/meta', 'PUT', { migrated_at: new Date().toISOString(), skipped: SKIPPED })
}

console.log(`\n${'table'.padEnd(26)} ${'status'.padEnd(20)} ${'supabase'.padStart(9)} ${'rtdb'.padStart(6)}`)
let bad = 0
for (const [t, s, a, b] of report) { const mismatch = b !== '-' && a !== b; if (mismatch) bad++; console.log(`${t.padEnd(26)} ${s.padEnd(20)} ${String(a).padStart(9)} ${String(b).padStart(6)}${mismatch ? '  MISMATCH' : ''}`) }
console.log(`\nskipped on purpose: ${SKIPPED.join(', ')}`)
console.log(DRY ? 'dry run — nothing written' : bad ? `${bad} MISMATCH(ES)` : 'all counts match')
process.exit(bad ? 1 : 0)
