/**
 * CUSTOM FIELDS AND PROJECT SECTIONS ON TO-DOS (the owner, 20 Oct 2026: "asana has custom names of the columns have we
 * added all that from asana in existing ones and add this as a feature … u need to grab the column names existing ones
 * from asana"). Asana's three — Priority, Task Progress, Service Line — with their own options and colours, and each
 * client project's own sections ("Core Deliverables", "Editing Queu", "Done" …) as its board's columns. Pure.
 */

export const FIELD_TYPES = ['select', 'text', 'number', 'date'] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export type FieldOption = { id: string; name: string; colour: string }
export type TodoFieldDef = { id: string; name: string; type: FieldType; options?: FieldOption[]; position?: number | null }

/** Asana's option colours, as Asana draws them */
export const ASANA_COLOURS: Record<string, string> = {
  red: '#e8384f', orange: '#fd612c', 'yellow-orange': '#fd9a00', yellow: '#eec300', 'yellow-green': '#a4cf30',
  green: '#62d26f', 'blue-green': '#37c5ab', aqua: '#20aaea', blue: '#4186e0', indigo: '#7a6ff0', purple: '#aa62e3',
  magenta: '#e362e3', 'hot-pink': '#ea4e9d', pink: '#fc91ad', 'cool-gray': '#8da3a6', none: '#c4c4c4',
}
/** the palette a new option picks from */
export const OPTION_COLOURS = Object.values(ASANA_COLOURS).filter(c => c !== '#c4c4c4')

const HEX = /^#[0-9a-f]{6}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** A field as posted or stored, made safe — or why not. */
export function sanitiseFieldDef(raw: unknown): { ok: true; def: Omit<TodoFieldDef, 'id'> } | { ok: false; reason: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = str(r.name, 60)
  if (!name) return { ok: false, reason: 'Name the field' }
  const type = FIELD_TYPES.find(t => t === r.type)
  if (!type) return { ok: false, reason: 'A field is a dropdown, text, a number or a date' }
  const out: Omit<TodoFieldDef, 'id'> = { name, type }
  if (type === 'select') {
    const seen = new Set<string>()
    const options = (Array.isArray(r.options) ? r.options : []).flatMap((o, i) => {
      const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
      const n = str(x.name, 60)
      if (!n) return []
      let id = str(x.id, 40) || `o${i}_${n.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12)}`
      while (seen.has(id)) id = `${id}_`
      seen.add(id)
      const c = str(x.colour, 7)
      return [{ id, name: n, colour: HEX.test(c) ? c.toLowerCase() : OPTION_COLOURS[i % OPTION_COLOURS.length] }]
    }).slice(0, 40)
    if (!options.length) return { ok: false, reason: 'Give the dropdown at least one option' }
    out.options = options
  }
  if (r.position !== undefined && Number.isFinite(Number(r.position))) out.position = Number(r.position)
  return { ok: true, def: out }
}

/** One field's value, checked against its field — undefined when it is not a value it can hold (null clears it). */
export function fieldValue(def: TodoFieldDef, raw: unknown): string | number | null | undefined {
  if (raw === null || raw === '') return null
  switch (def.type) {
    case 'select': return typeof raw === 'string' && def.options?.some(o => o.id === raw) ? raw : undefined
    case 'text': return typeof raw === 'string' ? raw.trim().slice(0, 500) || null : undefined
    case 'number': { const n = Number(raw); return Number.isFinite(n) ? n : undefined }
    case 'date': return typeof raw === 'string' && DATE.test(raw) ? raw : undefined
  }
}

/** A to-do's field values after a change: the posted ones merged onto what it had, each checked; unknown fields dropped. */
export function mergeFieldValues(current: unknown, posted: unknown, defs: readonly TodoFieldDef[]): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  const cur = (current && typeof current === 'object' ? current : {}) as Record<string, unknown>
  const byId = new Map(defs.map(d => [d.id, d]))
  for (const [k, v] of Object.entries(cur)) { const d = byId.get(k); const val = d ? fieldValue(d, v) : undefined; if (val !== undefined && val !== null) out[k] = val }
  for (const [k, v] of Object.entries((posted && typeof posted === 'object' ? posted : {}) as Record<string, unknown>)) {
    const d = byId.get(k)
    if (!d) continue
    const val = fieldValue(d, v)
    if (val === null) delete out[k]
    else if (val !== undefined) out[k] = val
  }
  return out
}

/** what a value reads as: an option's name and colour, or the words */
export function fieldDisplay(def: TodoFieldDef, value: unknown): { text: string; colour?: string } | null {
  if (value === undefined || value === null || value === '') return null
  if (def.type === 'select') { const o = def.options?.find(x => x.id === value); return o ? { text: o.name, colour: o.colour } : null }
  return { text: String(value) }
}

/** fields in their order */
export function orderedFields<T extends { position?: number | null; name: string }>(defs: readonly T[]): T[] {
  return [...defs].sort((a, b) => (Number(a.position ?? 0) - Number(b.position ?? 0)) || a.name.localeCompare(b.name))
}

/** a project's sections in their order */
export function orderedSections<T extends { position?: number | null; name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (Number(a.position ?? 0) - Number(b.position ?? 0)) || a.name.localeCompare(b.name))
}

/** the list's columns: the task, due date, assignee, client, then one per field */
export function todoGridColumns(fieldCount: number): string {
  return [fieldCount ? 'minmax(280px,1fr)' : 'minmax(0,1fr)', '120px', '170px', '200px', ...Array.from({ length: fieldCount }, () => '170px')].join(' ')
}
