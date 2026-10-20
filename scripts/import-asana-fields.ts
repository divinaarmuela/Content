/**
 * ASANA'S CUSTOM FIELDS AND PROJECT SECTIONS, COPIED (the owner, 20 Oct 2026: "asana has custom names of the columns
 * … u need to grab the column names existing ones from asana"). Run with jiti:
 *
 *   npx jiti scripts/import-asana-fields.ts            # dry run: what it would make and set
 *   npx jiti scripts/import-asana-fields.ts --write    # make it
 *
 * 1. Asana's custom fields (Priority, Task Progress, Service Line …) → todo_fields, with their options and colours.
 * 2. Each Asana project that is a client → that client's sections, by Asana's own names, in Asana's order.
 * 3. Every to-do copied from Asana (asana_gid) → its section on its client's project, and its field values; a to-do
 *    with no client takes the project's client.
 * Asana is only read. Re-runnable: a field or section is matched on its Asana id and updated, never doubled.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ASANA_COLOURS } from '../app/lib/todo-fields-core'
import { sameClient } from '../app/lib/milanote-import-core'

const WRITE = process.argv.includes('--write')
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const DB = String(env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').replace(/\/$/, '')
const PAT = env.ASANA_PAT, WS = env.ASANA_WORKSPACE_GID
if (!DB || !PAT || !WS) { console.error('Missing NEXT_PUBLIC_FIREBASE_DATABASE_URL, ASANA_PAT or ASANA_WORKSPACE_GID'); process.exit(1) }

const asana = async (path: string) => {
  const out: unknown[] = []
  let next: string | null = path
  while (next) {
    const res = await fetch(`https://app.asana.com/api/1.0${next}`, { headers: { Authorization: `Bearer ${PAT}` } })
    const j = await res.json() as { data?: unknown; next_page?: { path?: string } | null; errors?: unknown }
    if (!res.ok) throw new Error(`Asana ${res.status} ${JSON.stringify(j.errors ?? j).slice(0, 200)}`)
    if (Array.isArray(j.data)) out.push(...j.data); else return j.data
    next = j.next_page?.path ?? null
  }
  return out
}
const dbGet = async (t: string) => Object.values(((await (await fetch(`${DB}/mdm/tables/${t}.json`)).json()) ?? {}) as Record<string, unknown>)
const dbPut = async (t: string, id: string, v: unknown) => { const r = await fetch(`${DB}/mdm/tables/${t}/${id}.json`, { method: 'PUT', body: JSON.stringify(v) }); if (!r.ok) throw new Error(`write ${t}/${id}: ${r.status}`) }
const dbPatch = async (t: string, id: string, v: unknown) => { const r = await fetch(`${DB}/mdm/tables/${t}/${id}.json`, { method: 'PATCH', body: JSON.stringify(v) }); if (!r.ok) throw new Error(`patch ${t}/${id}: ${r.status}`) }

/** Asana projects whose name is not their client's in the app */
const PROJECT_CLIENT: Record<string, string | null> = {
  'Turnkey Building Group': 'Justin Engelke',
  'Bond Street Dental': 'Bond Street',
  'Luxe Laser Skin and Laser Clinics': 'Luxe Laser Skin Solutions',
  'Capila Finance - Shan Narkhede': 'Capila Finance',
  'The Emerald': 'Emerald',
  'Build One & Arko Joinery': 'Build One',
  'Cecconis': "Cecconi's Toorak & Flinders",
  'ALIA Fragrances': 'Alia Fragrance',
  // the agency's own boards, not a client's
  '- Ads Management': null, '- Photo Shoot Request': null, '- Tech Team': null, '- Team Reporting': null, 'Project Template': null,
  '- MD Media': 'MD Media',
}

type Opt = { gid: string; name: string; color?: string; enabled?: boolean }
type Field = { gid: string; name: string; resource_subtype: string; enum_options?: Opt[] }

const main = async () => {
  const now = new Date().toISOString()
  const [clients, ourFields, ourSections, todos] = await Promise.all([dbGet('clients'), dbGet('todo_fields'), dbGet('todo_project_sections'), dbGet('todos')]) as [
    { id: string; name: string }[], { id: string; asana_gid?: string }[], { id: string; asana_gid?: string; client_id: string }[],
    { id: string; asana_gid?: string | null; client_id?: string | null; fields?: Record<string, unknown> | null; project_section_id?: string | null; title: string }[],
  ]
  const projects = await asana(`/projects?workspace=${WS}&archived=false&limit=100&opt_fields=name,custom_field_settings.custom_field.name,custom_field_settings.custom_field.resource_subtype,custom_field_settings.custom_field.enum_options.name,custom_field_settings.custom_field.enum_options.color,custom_field_settings.custom_field.enum_options.enabled`) as { gid: string; name: string; custom_field_settings?: { custom_field: Field }[] }[]

  /* 1. the fields */
  const fields = new Map<string, Field>()
  for (const p of projects) for (const s of p.custom_field_settings ?? []) fields.set(s.custom_field.gid, s.custom_field)
  const fieldId = new Map<string, string>()   // asana gid → our id
  const optionId = new Map<string, string>()  // asana option gid → our option id
  // Asana has two fields both called "Task Progress": one field here, with every option of both (by name)
  const byName = new Map<string, Field[]>()
  for (const f of fields.values()) byName.set(f.name.trim(), [...(byName.get(f.name.trim()) ?? []), f])
  console.log('FIELDS')
  let pos = 1024
  for (const [name, same] of byName) {
    const f = same[0]
    const type = f.resource_subtype === 'enum' ? 'select' : f.resource_subtype === 'number' ? 'number' : f.resource_subtype === 'date' ? 'date' : 'text'
    const id = ourFields.find(x => same.some(g => g.gid === x.asana_gid))?.id ?? randomUUID()
    const options: { id: string; name: string; colour: string }[] = []
    for (const g of same) {
      fieldId.set(g.gid, id)
      for (const o of g.enum_options ?? []) {
        if (o.enabled === false) continue
        const kept = options.find(x => x.name.toLowerCase() === o.name.trim().toLowerCase())
        if (kept) { optionId.set(o.gid, kept.id); continue }
        options.push({ id: o.gid, name: o.name.trim(), colour: ASANA_COLOURS[o.color ?? 'none'] ?? ASANA_COLOURS.none })
        optionId.set(o.gid, o.gid)
      }
    }
    console.log(`  ${name} (${type})${same.length > 1 ? ` — ${same.length} Asana fields as one` : ''}${options.length ? ': ' + options.map(o => o.name).join(', ') : ''}`)
    if (WRITE) await dbPut('todo_fields', id, { id, name, type, options, position: pos, asana_gid: f.gid, created_at: now, updated_at: now })
    pos += 1024
  }

  /* 2. each client project's sections, 3. its tasks' sections and values */
  const byGid = new Map(todos.filter(t => t.asana_gid).map(t => [String(t.asana_gid), t]))
  let placed = 0, valued = 0, clientSet = 0, sectionsMade = 0
  console.log('\nPROJECTS')
  for (const p of projects) {
    const wanted = p.name in PROJECT_CLIENT ? PROJECT_CLIENT[p.name] : p.name
    if (wanted === null) { console.log(`  ${p.name} — the agency's own, skipped`); continue }
    const client = clients.find(c => c.name === wanted) ?? clients.find(c => sameClient(c.name, String(wanted)))
    if (!client) { console.log(`  ${p.name} — NO CLIENT MATCHED, skipped`); continue }
    const sections = await asana(`/projects/${p.gid}/sections?opt_fields=name`) as { gid: string; name: string }[]
    const secId = new Map<string, string>()
    sections.forEach((s, i) => {
      const id = ourSections.find(x => x.asana_gid === s.gid)?.id ?? randomUUID()
      secId.set(s.gid, id)
    })
    if (WRITE) for (const [i, s] of sections.entries()) await dbPut('todo_project_sections', secId.get(s.gid)!, { id: secId.get(s.gid), client_id: client.id, name: s.name, position: (i + 1) * 1024, asana_gid: s.gid, created_at: now, updated_at: now })
    sectionsMade += sections.length
    const tasks = await asana(`/projects/${p.gid}/tasks?limit=100&opt_fields=memberships.project.gid,memberships.section.gid,custom_fields.gid,custom_fields.enum_value.gid,custom_fields.number_value,custom_fields.text_value,custom_fields.date_value`) as {
      gid: string; memberships?: { project?: { gid: string }; section?: { gid: string } }[]
      custom_fields?: { gid: string; enum_value?: { gid: string } | null; number_value?: number | null; text_value?: string | null; date_value?: { date?: string } | null }[]
    }[]
    let here = 0
    for (const t of tasks) {
      const ours = byGid.get(t.gid)
      if (!ours) continue
      const patch: Record<string, unknown> = {}
      const sec = t.memberships?.find(m => m.project?.gid === p.gid)?.section?.gid
      if (sec && secId.has(sec)) { patch.project_section_id = secId.get(sec); placed++ }
      if (!ours.client_id) { patch.client_id = client.id; clientSet++ }
      const vals: Record<string, unknown> = { ...(ours.fields ?? {}) }
      let any = false
      for (const cf of t.custom_fields ?? []) {
        const id = fieldId.get(cf.gid)
        if (!id) continue
        const v = cf.enum_value?.gid ? optionId.get(cf.enum_value.gid) ?? null : cf.number_value ?? cf.text_value ?? cf.date_value?.date ?? null
        if (v === null || v === undefined || v === '') continue
        vals[id] = v; any = true
      }
      if (any) { patch.fields = vals; valued++ }
      if (Object.keys(patch).length) { here++; if (WRITE) await dbPatch('todos', ours.id, { ...patch, updated_at: now }) }
    }
    console.log(`  ${p.name} → ${client.name}: ${sections.length} sections (${sections.map(s => s.name).join(' · ')}); ${tasks.length} Asana tasks, ${here} of ours updated`)
  }
  console.log(`\n${byName.size} fields; ${sectionsMade} sections; ${placed} to-dos placed in a section, ${valued} given field values, ${clientSet} given their project's client`)
  if (!WRITE) console.log('Dry run — nothing written. Add --write to make it.')
}
main().catch(e => { console.error(e); process.exit(1) })
