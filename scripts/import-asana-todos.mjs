#!/usr/bin/env node
/**
 * COPY ASANA'S OPEN TASKS INTO OUR TO-DOS — SILENTLY (the owner, 18 Oct 2026:
 * "copy asana tasks make sure no notification silent move").
 *
 *   node scripts/import-asana-todos.mjs            # dry run: reads, prints, writes NOTHING
 *   node scripts/import-asana-todos.mjs --write    # writes the to-dos and their comments
 *
 * Silent by construction: it never goes through the app's routes, so no bell
 * row, no email and no activity line is made. It writes straight to the
 * database over REST (/mdm/tables/todos, /mdm/tables/todo_comments), the
 * same way lib/db.ts does.
 *
 * Asana is only READ (GET requests). Nothing in Asana is changed.
 *
 * What is copied: every INCOMPLETE task in the workspace's live projects,
 * plus every incomplete task assigned to someone on our team (the ones in no
 * project live only in My tasks), plus their incomplete subtasks (as our
 * subtasks). For each: name, description, due date, assignee (matched to our
 * team by email), creator, collaborators, and its comments (oldest first,
 * the writer matched by email; an unmatched writer's name leads the text).
 * Re-running is safe: a task already copied (asana_gid) is skipped.
 *
 * REPEATING TASKS (20 Oct 2026, Manal's missing to-dos): Asana makes a NEW task each time a repeating one is
 * ticked, so a one-off copy misses every round after it. A re-run copies the round that is open now, and:
 *   - skips it when that person already has an OPEN to-do of the same title here (they re-made it by hand);
 *   - gives it our repeat rule (todo-repeat-core), read off its past rounds in Asana — Asana's API does not hand
 *     the rule itself out. Every round a weekday apart → Weekly Mon–Fri; always 7 days → Weekly on that day;
 *     always 1 day → Daily; always about a month → Monthly. Anything else: copied with no rule, and listed.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const WRITE = process.argv.includes('--write')
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const PAT = env.ASANA_PAT
const WS = env.ASANA_WORKSPACE_GID
const DB = (env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').replace(/\/$/, '')
if (!PAT || !WS || !DB) { console.error('Missing ASANA_PAT, ASANA_WORKSPACE_GID or NEXT_PUBLIC_FIREBASE_DATABASE_URL in .env.local'); process.exit(1) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function asana(path) {
  const out = []
  let url = `https://app.asana.com/api/1.0${path}${path.includes('?') ? '&' : '?'}limit=100`
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } })
    if (res.status === 429) { await sleep(Number(res.headers.get('retry-after') ?? 5) * 1000); continue }
    if (!res.ok) throw new Error(`Asana ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`)
    const j = await res.json()
    if (Array.isArray(j.data)) out.push(...j.data); else return j.data
    url = j.next_page?.uri ?? null
  }
  return out
}
async function dbGet(path) { const r = await fetch(`${DB}/mdm/tables/${path}.json`); if (!r.ok) throw new Error(`db ${r.status} ${path}`); return (await r.json()) ?? {} }
async function dbPut(path, value) { const r = await fetch(`${DB}/mdm/tables/${path}.json`, { method: 'PUT', body: JSON.stringify(value) }); if (!r.ok) throw new Error(`db write ${r.status} ${path}: ${await r.text()}`) }

const FIELDS = 'name,notes,completed,due_on,created_at,created_by.email,created_by.name,assignee.email,assignee.name,followers.email,parent.gid,num_subtasks,projects.name,permalink_url'

// our team, by email
const team = Object.values(await dbGet('team_users')).filter(u => u.role !== 'client' && u.active_status !== false)
const byEmail = new Map(team.map(u => [String(u.email ?? '').toLowerCase(), u]))
const idOf = email => (email ? byEmail.get(String(email).toLowerCase())?.id ?? null : null)

// our clients: an Asana project named after a client puts its tasks on that client
const clients = Object.values(await dbGet('clients')).filter(c => c.name && (c.status ?? 'active') !== 'deleted')
const clientOfProjects = ps => {
  for (const p of ps ?? []) {
    const n = String(p.name ?? '').toLowerCase()
    const hit = clients.filter(c => n.includes(String(c.name).toLowerCase()) || String(c.name).toLowerCase().includes(n.replace(/^[-\s]+/, '').trim()) && n.replace(/^[-\s]+/, '').trim().length > 3)
    if (hit.length === 1) return hit[0]
  }
  return null
}

// what is already here
const existing = Object.values(await dbGet('todos'))
const already = new Set(existing.map(t => t.asana_gid).filter(Boolean))
const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
// an open to-do this person already has under the same title: re-made here by hand, not copied again
const remade = (title, owner) => existing.find(e => e.status !== 'done' && norm(e.title) === norm(title) && (e.owner_id ?? null) === (owner ?? null))

// THE REPEAT RULE, read off the task's past rounds in Asana (dates as calendar days)
const dayMs = 86400000
const dow = d => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7   // Monday 0
async function repeatOf(t) {
  if (!t.assignee?.gid || !t.due_on) return null
  const rounds = await asana(`/workspaces/${WS}/tasks/search?text=${encodeURIComponent(t.name)}&assignee.any=${t.assignee.gid}&opt_fields=name,due_on&sort_by=created_at`)
  const dues = [...new Set(rounds.filter(r => norm(r.name) === norm(t.name) && r.due_on).map(r => r.due_on))].sort().slice(-10)
  if (dues.length < 3) return null
  const gaps = dues.slice(1).map((d, i) => Math.round((Date.parse(d) - Date.parse(dues[i])) / dayMs))
  const days = [...new Set(dues.map(dow))].sort()
  if (gaps.every(g => g === 1)) return { freq: 'daily' }
  if (gaps.every(g => g === 7)) return { freq: 'weekly', days: [dow(dues[dues.length - 1])] }
  // each round on the NEXT of the weekdays it has been seen on — Mon–Fri, Mon–Sat, Tue/Thu/Fri (Manal's
  // "Community Management for All Clients", 20 Oct 2026): weekly on exactly those days
  const nextOn = (d, g) => { for (let i = 1; i <= 7; i++) { if (days.includes(dow(new Date(Date.parse(d) + i * dayMs).toISOString().slice(0, 10)))) return i === g } return false }
  if (days.length > 1 && gaps.every((g, i) => nextOn(dues[i], g))) return { freq: 'weekly', days }
  if (gaps.every(g => g >= 28 && g <= 31)) return { freq: 'monthly' }
  return null
}

// 1. every incomplete task in the live projects
const tasks = new Map()
const projects = await asana(`/projects?workspace=${WS}&archived=false&opt_fields=name`)
for (const p of projects) {
  for (const t of await asana(`/tasks?project=${p.gid}&completed_since=now&opt_fields=${FIELDS}`)) tasks.set(t.gid, t)
}
// 2. every incomplete task assigned to one of our people (catches My-tasks-only work)
const users = await asana(`/users?workspace=${WS}&opt_fields=email,name`)
for (const u of users) {
  if (!idOf(u.email)) continue
  for (const t of await asana(`/tasks?assignee=${u.gid}&workspace=${WS}&completed_since=now&opt_fields=${FIELDS}`)) tasks.set(t.gid, t)
}
// 3. their incomplete subtasks
for (const t of [...tasks.values()]) {
  if (!t.num_subtasks) continue
  for (const s of await asana(`/tasks/${t.gid}/subtasks?opt_fields=${FIELDS}`)) if (!s.completed) tasks.set(s.gid, { ...s, parent: { gid: t.gid } })
}

const open = [...tasks.values()].filter(t => !t.completed && !already.has(t.gid))
const ourId = new Map(open.map(t => [t.gid, randomUUID()]))
const topFirst = [...open].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0))
const unmatched = new Set()

console.log(`${WRITE ? 'WRITING' : 'DRY RUN (nothing written)'} — ${projects.length} projects, ${tasks.size} tasks read, ${open.length} to copy, ${tasks.size - open.length} skipped (done or already copied)\n`)

let written = 0, commentsWritten = 0
const noRule = []
for (const t of topFirst) {
  const owner = idOf(t.assignee?.email)
  if (remade(t.name, owner)) { console.log(`= ${t.name}  [already here, re-made by hand — not copied]`); continue }
  if (t.assignee && !owner) unmatched.add(`${t.assignee.name} <${t.assignee.email ?? 'no email'}>`)
  const parentId = t.parent?.gid ? ourId.get(t.parent.gid) ?? existing.find(e => e.asana_gid === t.parent.gid)?.id ?? null : null
  const followers = [...new Set((t.followers ?? []).map(f => idOf(f.email)).filter(Boolean))]
  const where = (t.projects ?? []).map(p => p.name).join(', ')
  const note = [t.notes?.trim() || null, `From Asana${where ? ` (${where})` : ''}${t.assignee && !owner ? ` — assigned there to ${t.assignee.name}` : ''}: ${t.permalink_url ?? ''}`].filter(Boolean).join('\n\n')
  const now = new Date().toISOString()
  const row = {
    id: ourId.get(t.gid),
    title: String(t.name || 'Untitled task').slice(0, 200),
    note: note.slice(0, 4000),
    status: 'open',
    due_date: t.due_on ?? null,
    owner_id: owner,
    created_by: idOf(t.created_by?.email),
    client_id: clientOfProjects(t.projects)?.id ?? (t.parent?.gid ? clientOfProjects(tasks.get(t.parent.gid)?.projects)?.id ?? null : null),
    files: [],
    parent_id: parentId,
    followers,
    likes: [],
    section_id: null,
    position: Date.parse(t.created_at ?? now) || Date.now(),
    blocked_by: [],
    asana_gid: t.gid,
    repeat: t.parent?.gid ? null : await repeatOf(t),
    created_at: t.created_at ?? now,
    updated_at: now,
    done_at: null,
    done_by: null,
  }
  const stories = await asana(`/tasks/${t.gid}/stories?opt_fields=type,text,created_at,created_by.email,created_by.name`)
  const comments = stories.filter(s => s.type === 'comment' && String(s.text ?? '').trim())
  const ruleWords = row.repeat ? (row.repeat.freq === 'weekly' ? `repeats weekly ${row.repeat.days.map(d => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join('/')}` : `repeats ${row.repeat.freq}`) : 'NO REPEAT'
  if (!row.repeat && !parentId) noRule.push(row.title)
  console.log(`${parentId ? '   └ ' : '• '}${row.title}  [${ruleWords} · ${where || 'no project'} → ${row.client_id ? clients.find(c => c.id === row.client_id)?.name : 'no client'} · ${row.due_date ?? 'no date'} · ${owner ? (team.find(u => u.id === owner)?.name ?? owner) : (t.assignee ? `unmatched: ${t.assignee.name}` : 'no assignee')} · ${comments.length} comment${comments.length === 1 ? '' : 's'}]`)
  if (!WRITE) continue
  await dbPut(`todos/${row.id}`, row)
  written++
  for (const c of comments) {
    const author = idOf(c.created_by?.email)
    const cid = randomUUID()
    await dbPut(`todo_comments/${cid}`, {
      id: cid, todo_id: row.id, author_id: author,
      body: (author ? c.text : `${c.created_by?.name ?? 'Someone'} (in Asana): ${c.text}`).slice(0, 4000),
      mentions: [], likes: [], asana_gid: c.gid, created_at: c.created_at, updated_at: c.created_at,
    })
    commentsWritten++
  }
}

console.log(`\n${WRITE ? `Wrote ${written} to-dos and ${commentsWritten} comments.` : 'Dry run only — run again with --write to copy.'}`)
if (noRule.length) console.log(`\nNo repeat pattern found (copied as one-off to-dos — set Repeats by hand if they repeat):\n  ${noRule.join('\n  ')}`)
if (unmatched.size) console.log(`\nAssignees in Asana with no matching team member here (their to-dos have no assignee; the note says who): \n  ${[...unmatched].join('\n  ')}`)
