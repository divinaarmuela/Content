/**
 * Pure core for "create an intake form from a document" — no I/O, no SDK, no
 * network, fully unit-tested (tests/intake-scan-core.test.ts).
 *
 * Everything a model hands back passes through here before a human ever sees
 * it. The model is a drafting assistant, not a source of truth: it invents
 * question types we do not have, forgets the choices on a multiple-choice
 * question, repeats the same question twice because the document did, and
 * cheerfully turns a restaurant menu into a "form". Each of those is repaired
 * or refused here rather than left to surface as a nonsense form in front of a
 * client.
 *
 * Nothing in this file writes anything. The output is a draft that opens in the
 * normal builder; the person saves it through the existing save path or throws
 * it away.
 */

import {
  normaliseDefinition, slugify,
  type BlockType, type Block, type Section, type TemplateDefinition, type TemplateKey,
} from './intake-core'

// ── what we will read ────────────────────────────────────────────────────────

/** 20 MB. A questionnaire is text and a few logos; anything bigger is a deck. */
export const MAX_SCAN_BYTES = 20 * 1024 * 1024

/**
 * How much text of a plain-text document is sent to the model. ~40k characters
 * is roughly 10k tokens — comfortably more than any real intake questionnaire,
 * and a hard stop on the cost of someone dropping in a 300-page manual.
 */
export const MAX_DOC_CHARS = 40_000

export type ScanKind = 'pdf' | 'image' | 'text'

export type Accepted = { kind: ScanKind; mediaType: string }
export type Refusal = { message: string; status: number }

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}

function extensionOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

/**
 * Decide whether we can read this file, in plain words when we cannot.
 *
 * The extension and the browser's declared type are both consulted — a file
 * dragged out of a mail client often arrives as `application/octet-stream`, and
 * refusing a perfectly readable PDF over that is the kind of thing that makes
 * people stop using a feature.
 */
export function classifyUpload(
  filename: string, mimeType: string, size: number,
): Accepted | Refusal {
  const ext = extensionOf(filename)
  const type = (mimeType || '').toLowerCase().split(';')[0].trim()

  // Word first, so it gets its own sentence rather than the generic refusal.
  // There is no .docx text extractor in this project's dependencies and this
  // feature is not worth adding one for: a PDF is one "Save as" away.
  if (ext === 'docx' || ext === 'doc'
    || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || type === 'application/msword') {
    return {
      message: 'We cannot read Word documents. Open it in Word or Google Docs, '
        + 'save it as a PDF, and add that instead.',
      status: 415,
    }
  }

  let accepted: Accepted | null = null
  if (ext === 'pdf' || type === 'application/pdf') {
    accepted = { kind: 'pdf', mediaType: 'application/pdf' }
  } else if (IMAGE_TYPES[ext] || ['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
    accepted = { kind: 'image', mediaType: IMAGE_TYPES[ext] ?? type }
  } else if (ext === 'txt' || ext === 'md' || ext === 'markdown'
    || type === 'text/plain' || type === 'text/markdown' || type === 'text/x-markdown') {
    accepted = { kind: 'text', mediaType: 'text/plain' }
  }

  if (!accepted) {
    return {
      message: 'We can read PDFs, photos and screenshots (PNG, JPG or WEBP), and '
        + 'plain text or Markdown files. That file is none of those.',
      status: 415,
    }
  }

  if (!Number.isFinite(size) || size <= 0) {
    return { message: 'That file is empty.', status: 400 }
  }
  if (size > MAX_SCAN_BYTES) {
    return {
      message: 'That file is bigger than 20 MB. Try a smaller document, or save '
        + 'just the pages with the questions on them.',
      status: 413,
    }
  }
  return accepted
}

export function isRefusal(x: Accepted | Refusal): x is Refusal {
  return 'message' in x
}

export type Truncated = { text: string; note: string | null }

/** Cut a long document down to the budget and say so, in a sentence a
 *  non-technical person can act on. */
export function truncateDocument(text: string, limit: number = MAX_DOC_CHARS): Truncated {
  if (text.length <= limit) return { text, note: null }
  const percent = Math.max(1, Math.round((limit / text.length) * 100))
  return {
    text: text.slice(0, limit),
    note: `That document was long, so only the first ${percent}% of it was read. `
      + 'Check the end of your form for anything missing.',
  }
}

// ── repairing what the model sends back ──────────────────────────────────────

/**
 * Pull a JSON object out of a reply that should have been JSON and was not
 * quite. Handles the three things models actually do: wrap it in a ```json
 * fence, chat before and after it, and leave a trailing comma. Anything worse
 * than that is a failed scan, not something to guess at.
 */
export function repairJson(raw: string): unknown {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const candidates: string[] = [trimmed]

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) candidates.push(fenced[1].trim())

  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1))

  for (const candidate of candidates) {
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const parsed: unknown = JSON.parse(attempt)
        if (parsed && typeof parsed === 'object') return parsed
      } catch { /* try the next repair */ }
    }
  }
  return null
}

/** Every synonym a model reaches for, mapped onto a type this app actually
 *  renders. Anything not here becomes a short answer and is flagged for a
 *  human to look at. */
const TYPE_ALIASES: Record<string, BlockType> = {
  short_text: 'short_text', short: 'short_text', text: 'short_text', string: 'short_text',
  line: 'short_text', name: 'short_text', input: 'short_text',
  // real question types we do not have a control for; a line of text is the
  // honest fallback and loses nothing
  date: 'short_text', number: 'short_text', email: 'short_text', phone: 'short_text',
  tel: 'short_text', time: 'short_text', currency: 'short_text', rating: 'short_text',
  scale: 'short_text', address: 'short_text',

  long_text: 'long_text', long: 'long_text', paragraph: 'long_text', textarea: 'long_text',
  essay: 'long_text', multiline: 'long_text',

  link: 'link', url: 'link', website: 'link',

  select: 'select', dropdown: 'select', radio: 'select', single_select: 'select',
  choice: 'select', single_choice: 'select', pick_one: 'select', yes_no: 'select',
  boolean: 'select',

  multi_select: 'multi_select', multiselect: 'multi_select', checkbox: 'multi_select',
  checkboxes: 'multi_select', multiple_choice: 'multi_select', multi_choice: 'multi_select',
  pick_several: 'multi_select', tags: 'multi_select',

  file: 'file', upload: 'file', attachment: 'file', image: 'file', photo: 'file',

  guidance: 'guidance', note: 'guidance', info: 'guidance', instruction: 'guidance',
  instructions: 'guidance', heading: 'guidance', statement: 'guidance', text_block: 'guidance',
}

const YES_NO = ['Yes', 'No']

/** A document that never names itself still needs a title, and the editor this
 *  draft opens in is shared by the intake form, the monthly form and the
 *  settings templates — so "Intake form" was wrong two times out of three. */
function fallbackName(key: TemplateKey): string {
  return key === 'ongoing' ? 'Monthly form' : 'Intake form'
}

/** Page furniture, not questions. A scanned questionnaire is full of it and a
 *  model will happily hand back "Page 2 of 7" as a short-answer question. */
const NOISE = [
  /^page\s*\d+(\s*(of|\/)\s*\d+)?$/i,
  /^\d+\s*(of|\/)\s*\d+$/i,
  /^[\d\s.\-–—_|•*]+$/,                       // numbers, bullets, rules
  /^[ivxlcdm]+$/i,                            // a roman numeral alone
  /^(©|\(c\)\s|copyright\b)/i,
  /^all rights reserved/i,
  /^(confidential|internal use only|for office use( only)?)\b/i,
  /^(logo|image|figure|fig\.?|table)\s*\d*$/i,
  /^(https?:\/\/|www\.)\S*$/i,                // a bare URL on its own line
  /^(continued|cont\.?|end of (form|document|section))$/i,
]

function isNoise(label: string): boolean {
  const s = label.trim()
  if (s.length < 3) return true
  return NOISE.some(re => re.test(s))
}

/** The comparison key for "we have already got this question". Punctuation and
 *  the trailing colon a document puts on every field are ignored, so
 *  "Business name:" and "Business Name" are the one question they clearly are. */
export function questionKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export type ScanOutcome =
  | {
      ok: true
      definition: TemplateDefinition
      /** block ids the model was unsure about, or that we repaired for it —
       *  the builder puts a quiet "check this one" marker on each */
      uncertain: string[]
      /** plain sentences for the banner: what was truncated, merged or changed */
      notes: string[]
    }
  | { ok: false; message: string }

const MAX_SECTIONS = 30
const MAX_QUESTIONS = 200
const MAX_CHOICES = 30

type RawQuestion = {
  label?: unknown; text?: unknown; question?: unknown
  type?: unknown; help?: unknown; hint?: unknown
  choices?: unknown; options?: unknown
  confidence?: unknown
}
type RawSection = { title?: unknown; name?: unknown; intro?: unknown; description?: unknown; questions?: unknown; blocks?: unknown }

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Turn whatever the model returned into a definition this app can render, or
 * into one plain sentence saying why it could not.
 *
 * `key` is carried through untouched: the draft replaces the questions of the
 * form being edited, not its category.
 */
export function normaliseScan(
  raw: unknown, key: TemplateKey, extra: { notes?: string[] } = {},
): ScanOutcome {
  const notes: string[] = [...(extra.notes ?? [])]

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      message: 'We could not read a form out of that document. Try a clearer copy, '
        + 'or add the questions yourself.',
    }
  }
  const src = raw as Record<string, unknown>

  // the model's own verdict, honoured rather than second-guessed: a menu, an
  // invoice or a contract should say so instead of producing a nonsense draft
  const isForm = src.is_form
  if (isForm === false || isForm === 'false') {
    const reason = str(src.not_a_form_reason) || str(src.reason)
    return {
      ok: false,
      message: reason
        ? `This does not look like a form. ${reason}`
        : 'This does not look like a form, so there was nothing to turn into questions.',
    }
  }
  if (src.unreadable === true) {
    const reason = str(src.unreadable_reason)
    return {
      ok: false,
      message: reason
        ? `We could not read that document. ${reason}`
        : 'We could not make out the writing on that document. A clearer photo or '
          + 'a text-based PDF usually works.',
    }
  }

  const rawSections: RawSection[] = Array.isArray(src.sections)
    ? (src.sections as RawSection[])
    // a one-page form often comes back as a flat list of questions
    : Array.isArray(src.questions) ? [{ title: str(src.name) || 'Questions', questions: src.questions }]
    : []

  const seenIds = new Set<string>()
  const seenQuestions = new Set<string>()
  const uncertain: string[] = []
  let duplicates = 0
  let repairedChoices = 0
  let unknownTypes = 0
  let questionCount = 0

  const uniqueId = (candidate: string, fallback: string): string => {
    let id = slugify(candidate, fallback)
    let n = 0
    while (seenIds.has(id)) id = `${slugify(candidate, fallback)}_${++n}`
    seenIds.add(id)
    return id
  }

  const sections: Section[] = []

  for (const [si, rawSection] of rawSections.slice(0, MAX_SECTIONS).entries()) {
    const s = (rawSection ?? {}) as RawSection
    const rawQuestions: RawQuestion[] = Array.isArray(s.questions) ? s.questions as RawQuestion[]
      : Array.isArray(s.blocks) ? s.blocks as RawQuestion[]
      : []

    const blocks: Block[] = []
    for (const [bi, rawQuestion] of rawQuestions.entries()) {
      if (questionCount >= MAX_QUESTIONS) break
      const q = (rawQuestion ?? {}) as RawQuestion
      const label = str(q.label) || str(q.text) || str(q.question)
      if (!label || isNoise(label)) continue

      const alias = str(q.type).toLowerCase().replace(/[\s-]+/g, '_')
      let type: BlockType = TYPE_ALIASES[alias] ?? 'short_text'
      let flagged = str(q.confidence).toLowerCase() === 'low'
      if (alias && !TYPE_ALIASES[alias]) { unknownTypes++; flagged = true }

      // a repeated question merges two answers into one on the way back in;
      // the document repeating it is not a reason for the form to
      const dedupeKey = questionKey(label)
      if (type !== 'guidance') {
        if (seenQuestions.has(dedupeKey)) { duplicates++; continue }
        seenQuestions.add(dedupeKey)
      }

      let options = (Array.isArray(q.choices) ? q.choices : Array.isArray(q.options) ? q.options : [])
        .map(o => String(o ?? '').trim()).filter(Boolean)
      // "Yes / No" comes back as a boolean type with no choices at all
      if ((type === 'select' || type === 'multi_select') && options.length === 0
        && (alias === 'yes_no' || alias === 'boolean')) {
        options = [...YES_NO]
      }
      options = Array.from(new Set(options)).slice(0, MAX_CHOICES)

      if ((type === 'select' || type === 'multi_select') && options.length < 2) {
        // a choice question with nothing to choose from renders as an empty
        // dropdown — a line of text at least asks the question
        type = 'short_text'
        options = []
        repairedChoices++
        flagged = true
      }

      const block: Block = {
        id: uniqueId(label, `q_${si}_${bi}`),
        type,
        label: label.slice(0, 300),
      }
      const help = (str(q.help) || str(q.hint)).slice(0, 300)
      if (help) block.help = help
      if (type === 'select' || type === 'multi_select') block.options = options
      if (flagged && type !== 'guidance') uncertain.push(block.id)

      blocks.push(block)
      if (type !== 'guidance') questionCount++
    }

    // a section with nothing in it is a heading the model mistook for a
    // section; it would render as an empty page for the client
    if (blocks.length === 0) continue

    const title = (str(s.title) || str(s.name) || `Section ${sections.length + 1}`).slice(0, 120)
    const section: Section = { id: uniqueId(title, `s_${si}`), title, blocks }
    const intro = (str(s.intro) || str(s.description)).slice(0, 500)
    if (intro) section.intro = intro
    sections.push(section)
  }

  if (sections.length === 0 || questionCount === 0) {
    return {
      ok: false,
      message: 'We could not find any questions in that document. If it is a form, '
        + 'try a clearer copy; otherwise add the questions yourself.',
    }
  }

  if (duplicates > 0) {
    notes.push(duplicates === 1
      ? 'One repeated question was merged.'
      : `${duplicates} repeated questions were merged.`)
  }
  if (repairedChoices > 0) {
    notes.push(repairedChoices === 1
      ? 'One multiple-choice question had no choices, so it was changed to a short answer.'
      : `${repairedChoices} multiple-choice questions had no choices, so they were changed to short answers.`)
  }
  if (unknownTypes > 0) {
    notes.push(unknownTypes === 1
      ? 'One question was a kind we do not have, so it became a short answer.'
      : `${unknownTypes} questions were kinds we do not have, so they became short answers.`)
  }

  // the final shape goes through the SAME repair the save path uses, so a draft
  // can never be something the builder or the client's form cannot render. Ids
  // assigned above are already unique, so they survive untouched — which is
  // what keeps `uncertain` pointing at the right questions.
  const definition = normaliseDefinition(
    { name: str(src.name) || str(src.title) || fallbackName(key), sections },
    key,
  )

  return { ok: true, definition, uncertain, notes }
}
