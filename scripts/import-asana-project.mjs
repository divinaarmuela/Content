#!/usr/bin/env node
/**
 * ONE ASANA PROJECT INTO TO-DOS, WHOLE AND SILENT (the owner, 29 Oct 2026: "we need to import her stuff no misses in the
 * todo … make sure silent" — Asana's "- Team Operations").
 *
 *   node scripts/import-asana-project.mjs <snapshot.json>            # dry run: prints, writes NOTHING
 *   node scripts/import-asana-project.mjs <snapshot.json> --write    # writes
 *
 * Reads a snapshot made by reading the project in full (sections, every task open and done, every subtask, comments,
 * attachments, custom fields) and writes, straight to the database over REST — no app route, so no email, no bell,
 * no activity line:
 *   - the project as one of the agency's own (todo_projects), its members matched to our team by email;
 *   - its sections in Asana's order (todo_project_sections, under the project's id);
 *   - every task and subtask as a to-do on the project: name, description, done or open (with when and by whom), due
 *     date, assignee, creator, collaborators, likes, its section, Asana's custom fields where ours match;
 *   - every comment, by its writer when they are on our team (otherwise the name leads the text).
 * Stable ids (asana_<gid>), and any Asana task already copied by an earlier import is left as it is, so a re-run
 * never makes a second copy. Asana is not touched.
 */
import { readFileSync } from 'node:fs'

const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const WRITE = process.argv.includes('--write')
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z0-9_]+=/.test(l))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const DB = (env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').replace(/\/$/, '')
if (!file || !DB) { console.error('usage: node scripts/import-asana-project.mjs <snapshot.json> [--write]'); process.exit(1) }
const snap = JSON.parse(readFileSync(file, 'utf8'))

const dbGet = async p => { const r = await fetch(`${DB}/mdm/tables/${p}.json`); if (!r.ok) throw new Error(`db ${r.status} ${p}`); return (await r.json()) ?? {} }
const dbPatch = async body => { const r = await fetch(`${DB}/mdm/tables.json`, { method: 'PATCH', body: JSON.stringify(body) }); if (!r.ok) throw new Error(`db write ${r.status}: ${await r.text()}`) }

const team = Object.values(await dbGet('team_users')).filter(u => u.role !== 'client')
const byEmail = new Map(team.map(u => [String(u.email ?? '').toLowerCase(), u]))
const idOf = e => (e ? byEmail.get(String(e).toLowerCase())?.id ?? null : null)
const fields = Object.values(await dbGet('todo_fields'))
const existing = Object.values(await dbGet('todos'))
const copied = new Set(existing.map(t => t.asana_gid).filter(Boolean))

const now = new Date().toISOString()
const P = snap.project
const projectId = `asanaproj_${P.gid}`
const members = (P.members ?? []).map(m => idOf(m.email)).filter(Boolean)
const writes = {}
const unmatched = new Set()

writes[`todo_projects/${projectId}`] = {
  id: projectId, name: String(P.name).replace(/^[-\s]+/, '').trim(), colour: null,
  member_ids: [...new Set([...members, ...snap.tasks.map(t => idOf(t.assignee?.email)).filter(Boolean)])],
  asana_gid: P.gid, created_at: now, updated_at: now,
}
const secId = new Map()
snap.sections.forEach((s, i) => {
  const id = `asanasec_${s.gid}`
  secId.set(s.gid, id)
  writes[`todo_project_sections/${id}`] = { id, client_id: projectId, name: s.name, position: (i + 1) * 1024, asana_gid: s.gid, created_at: s.created_at ?? now, updated_at: now }
})

// one row per task, in the project's own order (the snapshot lists the project's tasks first, then their subtasks)
const tasks = [...new Map(snap.tasks.map(t => [t.gid, t])).values()]
const ourId = g => `asana_${g}`
let made = 0, skipped = 0, comments = 0
const order = new Map(tasks.map((t, i) => [t.gid, i]))
for (const t of tasks) {
  if (copied.has(t.gid)) { skipped++; continue }
  const owner = idOf(t.assignee?.email)
  if (t.assignee?.email && !owner) unmatched.add(t.assignee.email)
  const membership = (t.memberships ?? []).find(m => m.project?.gid === P.gid)
  const fieldValues = {}
  const extra = []
  for (const f of t.custom_fields ?? []) {
    if (!f.display_value) continue
    const ours = fields.find(x => x.name.toLowerCase() === String(f.name).toLowerCase())
    const opt = ours && (ours.options ?? []).find(o => o.name.toLowerCase() === String(f.display_value).toLowerCase())
    if (opt) fieldValues[ours.id] = opt.id
    else extra.push(`${f.name}: ${f.display_value}`)
  }
  const note = [String(t.notes ?? '').trim(), extra.length ? `(From Asana) ${extra.join(' · ')}` : ''].filter(Boolean).join('\n\n')
  const followers = (t.followers ?? []).map(f => idOf(f.email)).filter(id => id && id !== owner)
  writes[`todos/${ourId(t.gid)}`] = {
    id: ourId(t.gid),
    title: String(t.name || 'Untitled task').slice(0, 200),
    note: note.slice(0, 4000) || null,
    status: t.completed ? 'done' : 'open',
    due_date: t.due_on ?? (t.due_at ? String(t.due_at).slice(0, 10) : null),
    owner_id: owner,
    created_by: idOf(t.created_by?.email),
    client_id: projectId,
    files: [],
    parent_id: t.parent?.gid ? ourId(t.parent.gid) : null,
    followers: [...new Set(followers)],
    likes: (t.likes ?? []).map(l => idOf(l.user?.email)).filter(Boolean),
    section_id: null,
    position: order.get(t.gid) * 1024,
    blocked_by: (t.dependencies ?? []).map(d => ourId(d.gid)),
    asana_gid: t.gid,
    fields: Object.keys(fieldValues).length ? fieldValues : null,
    project_section_id: !t.parent && membership?.section?.gid ? secId.get(membership.section.gid) ?? null : null,
    created_at: t.created_at ?? now,
    updated_at: t.modified_at ?? now,
    done_at: t.completed ? (t.completed_at ?? t.modified_at ?? now) : null,
    done_by: t.completed ? idOf(t.completed_by?.email) : null,
  }
  made++
  for (const c of snap.comments[t.gid] ?? []) {
    if (!String(c.text ?? '').trim()) continue
    const author = idOf(c.created_by?.email)
    const id = `asanacom_${c.gid}`
    writes[`todo_comments/${id}`] = {
      id, todo_id: ourId(t.gid), author_id: author,
      body: (author ? c.text : `${c.created_by?.name ?? 'Someone'} (in Asana): ${c.text}`).slice(0, 4000),
      mentions: [], likes: [], asana_gid: c.gid, created_at: c.created_at, updated_at: c.created_at,
    }
    comments++
  }
}

const rows = Object.keys(writes)
console.log(`${WRITE ? 'WRITING' : 'DRY RUN (nothing written)'} — "${writes[`todo_projects/${projectId}`].name}": ${snap.sections.length} sections, ${made} to-dos (${skipped} already here, skipped), ${comments} comments`)
console.log('members:', writes[`todo_projects/${projectId}`].member_ids.map(id => team.find(u => u.id === id)?.name).join(', '))
const todoRows = rows.filter(k => k.startsWith('todos/')).map(k => writes[k])
for (const s of snap.sections) {
  const inIt = todoRows.filter(r => r.project_section_id === secId.get(s.gid))
  console.log(`  ${s.name}: ${inIt.length} tasks (${inIt.filter(r => r.status === 'open').length} open), ${todoRows.filter(r => inIt.some(p => p.id === r.parent_id)).length} subtasks`)
}
if (unmatched.size) console.log('assignees with no match here:', [...unmatched].join(', '))
if (WRITE) {
  for (let i = 0; i < rows.length; i += 200) await dbPatch(Object.fromEntries(rows.slice(i, i + 200).map(k => [k, writes[k]])))
  console.log(`wrote ${rows.length} rows`)
}
