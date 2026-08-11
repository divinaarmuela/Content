/**
 * Pure intake-form core — no imports, no I/O, fully unit-testable.
 * Owns the template shape, answer merging, completion counting and the status
 * machine. The server layer (intake.ts) executes these rules; nothing else
 * decides what a valid answer set looks like.
 */

export type TemplateKey = 'one_off' | 'launch' | 'rebrand' | 'ongoing'

/** `guidance` is copy, not a question — the italic "why we're asking" text that
 *  produces a considered answer instead of a one-liner. It never holds a value. */
export type BlockType =
  | 'guidance' | 'short_text' | 'long_text' | 'link'
  | 'select' | 'multi_select' | 'checkbox' | 'file'

export type Block = {
  /** stable — answers key off this, so relabelling a question never orphans one */
  id: string
  type: BlockType
  label: string
  help?: string
  options?: string[]
  placeholder?: string
}

export type Section = { id: string; title: string; intro?: string; blocks: Block[] }

export type TemplateDefinition = { key: TemplateKey; name: string; sections: Section[] }

export type Answers = Record<string, string | string[]>

export type IntakeStatus = 'draft' | 'sent' | 'in_progress' | 'submitted'

const MULTI: BlockType[] = ['multi_select', 'checkbox', 'file']

/** Every block that can hold an answer. Guidance is excluded by definition. */
export function answerableBlocks(def: TemplateDefinition): Block[] {
  return def.sections.flatMap(s => s.blocks).filter(b => b.type !== 'guidance')
}

/**
 * Apply a patch to an answer set.
 *
 * Autosave sends one field at a time, so this must never clobber the rest.
 * Keys absent from the template are dropped rather than stored: the public
 * route is unauthenticated, and a stray key would otherwise persist whatever
 * a caller invented.
 */
export function mergeAnswers(
  def: TemplateDefinition, current: Answers, patch: unknown,
): Answers {
  const known = new Map(answerableBlocks(def).map(b => [b.id, b]))
  const out: Answers = { ...current }
  if (!patch || typeof patch !== 'object') return out

  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const block = known.get(key)
    if (!block) continue

    if (MULTI.includes(block.type)) {
      const list = Array.isArray(raw) ? raw.map(String).filter(Boolean) : []
      if (list.length === 0) delete out[key]
      else out[key] = list
      continue
    }

    const value = raw == null ? '' : String(raw)
    // blank clears rather than storing "" — an empty answer and no answer are
    // the same thing, and storing both makes completion counting lie
    if (value.trim() === '') delete out[key]
    else out[key] = value
  }
  return out
}

export const BLOCK_TYPES: BlockType[] = [
  'guidance', 'short_text', 'long_text', 'link',
  'select', 'multi_select', 'checkbox', 'file',
]

const TEMPLATE_KEYS: TemplateKey[] = ['one_off', 'launch', 'rebrand', 'ongoing']

/** Turn a label into a stable id. Answers key off block ids, so this only ever
 *  runs for NEW blocks — an existing id is carried through untouched. */
export function slugify(input: string, fallback: string): string {
  const s = input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
  return s || fallback
}

/**
 * Validate and repair a definition arriving from a browser.
 *
 * A super admin edits their own client's form, so this is not a trust boundary
 * in the security sense — but it is a correctness one. Duplicate ids silently
 * merge two questions' answers into one, an unknown type renders as nothing,
 * and an empty label produces a question nobody can answer. All three are
 * repaired here rather than left to surface as a confused client on a Sunday.
 */
export function normaliseDefinition(raw: unknown, key: TemplateKey): TemplateDefinition {
  const src = (raw ?? {}) as Partial<TemplateDefinition>
  const seen = new Set<string>()
  let n = 0

  const uniqueId = (candidate: string, fallback: string): string => {
    let id = slugify(candidate, fallback)
    while (seen.has(id)) id = `${id}_${++n}`
    seen.add(id)
    return id
  }

  const sections: Section[] = (Array.isArray(src.sections) ? src.sections : [])
    .map((rawSection, si) => {
      const s = (rawSection ?? {}) as Partial<Section>
      const title = String(s.title ?? '').trim() || `Section ${si + 1}`
      const blocks: Block[] = (Array.isArray(s.blocks) ? s.blocks : [])
        .map((rawBlock, bi) => {
          const b = (rawBlock ?? {}) as Partial<Block>
          const type: BlockType = BLOCK_TYPES.includes(b.type as BlockType)
            ? (b.type as BlockType) : 'short_text'
          const label = String(b.label ?? '').trim() || `Question ${bi + 1}`
          const options = (Array.isArray(b.options) ? b.options : [])
            .map(o => String(o).trim()).filter(Boolean)

          // an existing id is carried through untouched so answers survive a
          // relabel; a NEW block has none, so its id comes from its label
          const existing = String(b.id ?? '').trim()
          const block: Block = {
            id: uniqueId(existing || label, `q_${si}_${bi}`),
            type, label,
          }
          const help = String(b.help ?? '').trim()
          if (help) block.help = help
          const placeholder = String(b.placeholder ?? '').trim()
          if (placeholder) block.placeholder = placeholder
          // options only mean anything on the two choice types; carrying them
          // elsewhere makes a later type change behave unpredictably
          if ((type === 'select' || type === 'multi_select') && options.length > 0) {
            block.options = options
          }
          return block
        })
      const section: Section = { id: uniqueId(String(s.id ?? ''), `s_${si}`), title, blocks }
      const intro = String(s.intro ?? '').trim()
      if (intro) section.intro = intro
      return section
    })

  return {
    key: TEMPLATE_KEYS.includes(key) ? key : 'one_off',
    name: String(src.name ?? '').trim() || 'Intake form',
    sections,
  }
}

/** Move an item within a list. Out-of-range moves are a no-op rather than an
 *  error — the caller is a pair of arrow buttons, and the ends are reachable. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const out = [...list]
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}

/**
 * Duplicate a section in place — for "two founders, two sections".
 *
 * The copy carries every question but no ids: the save path derives fresh
 * unique ids from the labels, so the original section's ids — and therefore
 * any answers already given against them — are never disturbed. The title is
 * numbered rather than suffixed with "(copy)": "The Founders" becomes
 * "The Founders 2", duplicating that gives "The Founders 3", and an existing
 * title is never collided with.
 */
export function duplicateSection(sections: Section[], si: number): Section[] {
  const src = sections[si]
  if (!src) return sections

  const m = src.title.trim().match(/^(.*?)\s*(\d+)$/)
  const base = (m ? m[1] : src.title).trim() || 'Section'
  let n = m ? parseInt(m[2], 10) + 1 : 2
  const titles = new Set(sections.map(s => s.title.trim().toLowerCase()))
  let title = `${base} ${n}`
  while (titles.has(title.toLowerCase())) title = `${base} ${++n}`

  const copy: Section = {
    id: '',
    title,
    blocks: src.blocks.map(b => {
      const nb: Block = { ...b, id: '' }
      if (nb.options) nb.options = [...nb.options]
      return nb
    }),
  }
  if (src.intro) copy.intro = src.intro

  const out = [...sections]
  out.splice(si + 1, 0, copy)
  return out
}

export type SectionProgress = { id: string; title: string; answered: number; total: number }
export type Completion = { answered: number; total: number; sections: SectionProgress[] }

function isAnswered(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  return typeof value === 'string' && value.trim() !== ''
}

/** Progress, for a client filling this in over three sittings. Never blocking —
 *  incomplete submission is explicitly allowed. */
export function completion(def: TemplateDefinition, answers: Answers): Completion {
  const sections = def.sections.map(s => {
    const blocks = s.blocks.filter(b => b.type !== 'guidance')
    return {
      id: s.id,
      title: s.title,
      answered: blocks.filter(b => isAnswered(answers[b.id])).length,
      total: blocks.length,
    }
  })
  return {
    answered: sections.reduce((n, s) => n + s.answered, 0),
    total: sections.reduce((n, s) => n + s.total, 0),
    sections,
  }
}

export type IntakeEvent = 'open' | 'save' | 'submit' | 'reopen'

/** Submitted forms are read-only. The token is the only credential, so a
 *  forwarded link must not be able to alter answers a shot list was built on. */
export function isWritable(status: IntakeStatus): boolean {
  return status !== 'submitted'
}

export function nextStatus(current: IntakeStatus, event: IntakeEvent): IntakeStatus {
  if (event === 'reopen') return current === 'submitted' ? 'in_progress' : current
  if (!isWritable(current)) return current
  if (event === 'submit') return 'submitted'
  // 'started' means they typed something, not that they opened the link
  if (event === 'save') return 'in_progress'
  return current
}

/**
 * Clean a list of notification recipients arriving from a form control.
 *
 * Lowercased, trimmed and de-duplicated so "Akmal@… " and "akmal@…" cannot
 * both be stored and both be emailed. Anything without a plausible address
 * shape is dropped rather than stored — a typo'd recipient is a notification
 * that silently never arrives, which is worse than one that was never
 * configured.
 */
export function normaliseRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const item of list) {
    const email = String(item ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue
    if (!out.includes(email)) out.push(email)
  }
  return out
}

/**
 * Who to notify when a form is submitted.
 *
 * A form's own list wins when it has one; otherwise the agency-wide default;
 * otherwise the sending mailbox, so a submission is never silently unannounced
 * because nobody configured anything. An EMPTY list on the form is a real
 * choice — "notify nobody for this one" — and is respected, which is why this
 * checks for null rather than for emptiness.
 */
export function resolveRecipients(
  formEmails: string[] | null | undefined,
  defaultEmails: string[] | null | undefined,
  fallback: string,
): string[] {
  if (formEmails !== null && formEmails !== undefined) return formEmails
  if (defaultEmails && defaultEmails.length > 0) return defaultEmails
  return fallback ? [fallback] : []
}
