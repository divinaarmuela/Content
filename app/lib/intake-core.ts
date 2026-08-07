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
