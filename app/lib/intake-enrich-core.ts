/**
 * Pure intake → client enrichment core — no I/O, fully unit-testable.
 *
 * When an intake form is submitted we fill in the client's primary CONTACT and
 * their BRAND profile from the answers, but ONLY where those are still empty —
 * a re-submit, or a later run, must never overwrite a hand edit. This file owns
 * two decisions and nothing else:
 *   1. the deterministic mapping (a stable intake block id → a field), and
 *   2. the gate that decides whether the one small AI call is worth making.
 *
 * Everything here is a pure function over the answers and the CURRENT profile.
 * The database work (reading the profile, inserting the contact, the rev-guarded
 * write) lives in intake-enrich.ts.
 */

import type { Answers } from './intake-core'
import { asHandle, type BrandProfile, type BrandFile } from './brand-profile-core'

// ── reading answers ─────────────────────────────────────────────────────────

/** One answer as trimmed text. A multi-answer (a multi_select) is joined; a
 *  file block's filenames are not read here — brand files come from the
 *  intake_files rows, which carry the URLs the answers do not. */
export function answerText(answers: Answers, id: string): string {
  const v = answers?.[id]
  if (Array.isArray(v)) return v.map(x => String(x ?? '').trim()).filter(Boolean).join(', ')
  return String(v ?? '').trim()
}

/** The block ids this module reads deterministically. Anything NOT in here is
 *  an "extra" answer the AI may be asked to mine for a name/email when a
 *  template was custom-edited and the standard contact fields are blank. */
export const MAPPED_IDS = new Set<string>([
  'primary_contact', 'contact_email', 'contact_mobile', 'best_call_window',
  'three_words', 'never_words', 'tone', 'tagline', 'socials',
  'brand_files', 'public_name', 'website',
])

/** The free-text answers that feed the voice summary. Spans templates: the
 *  first two are on rebrand/launch, the last three on the ongoing retainer. */
export const VOICE_SOURCE_IDS = [
  'admired', 'perception', 'brand_as_person', 'misconception', 'one_thing_remembered',
] as const

// ── contact ─────────────────────────────────────────────────────────────────

export type DerivedContact = {
  name: string
  role: string
  email: string
  phone: string
  notes: string
}

/** Split "Jane Smith, Managing Director" into a name and the title part. Splits
 *  on the FIRST separator only, so a title that itself contains a comma
 *  ("Owner, Founder") survives intact. No separator → all name, no role. */
export function parsePrimaryContact(raw: string): { name: string; role: string } {
  const s = raw.trim()
  if (!s) return { name: '', role: '' }
  const m = s.match(/^([^\n,–—\-|:]+)[\n,–—\-|:]+([\s\S]*)$/)
  if (!m) return { name: s.replace(/\s+/g, ' ').trim(), role: '' }
  return {
    name: m[1].replace(/\s+/g, ' ').trim(),
    role: m[2].replace(/\s+/g, ' ').trim(),
  }
}

/** The primary contact the standard fields describe, or null when there is
 *  nothing usable (no name AND no email). */
export function deriveContact(answers: Answers): DerivedContact | null {
  const { name, role } = parsePrimaryContact(answerText(answers, 'primary_contact'))
  const email = answerText(answers, 'contact_email')
  const phone = answerText(answers, 'contact_mobile')
  const window = answerText(answers, 'best_call_window')
  if (!name && !email) return null
  return {
    name,
    role,
    email,
    phone,
    notes: window ? `Best window for calls: ${window}` : '',
  }
}

// ── brand ───────────────────────────────────────────────────────────────────

/** The three tone options become a short phrase the brand card can show. An
 *  unrecognised (custom-edited) value is passed through as itself. */
export const TONE_PHRASES: Record<string, string> = {
  'Warm and family': 'Warm and family',
  'Aspirational and premium': 'Aspirational and premium',
  'Both, balanced': 'Warm and family, with an aspirational, premium edge',
}

export function deriveVoiceTone(answers: Answers): string {
  const raw = answerText(answers, 'tone')
  if (!raw) return ''
  return TONE_PHRASES[raw] ?? raw
}

/** Split a short free-text list ("bold, honest, local" / "bold and honest")
 *  into individual words/phrases. */
export function splitWords(raw: string): string[] {
  return raw
    .split(/[,\n/]|(?:\s+and\s+)|(?:\s*[;·•]\s*)/i)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Pull handle-like tokens out of the socials answer. Prefer explicit @handles;
 *  otherwise take comma/newline-separated single tokens (a phrase like "on
 *  Instagram" is not a handle and is dropped rather than mangled). */
export function extractHandles(raw: string): string[] {
  const ats = raw.match(/@[A-Za-z0-9_.]+/g)
  if (ats && ats.length) return ats
  return raw
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(s => s && !/\s/.test(s))
    .map(asHandle)
    .filter(Boolean)
}

/** Additive, empty-only merge: returns a copy of `current` with the intake's
 *  brand answers folded into the fields that are STILL empty, plus a flag
 *  saying whether anything was actually filled. Never overwrites. `voice.summary`
 *  is deliberately not touched here — it is the one AI-derived field and is
 *  merged separately by the caller. */
export function deriveBrandFill(
  answers: Answers,
  brandFiles: BrandFile[],
  current: BrandProfile,
): { profile: BrandProfile; changed: boolean } {
  const out: BrandProfile = {
    ...current,
    logo_files: [...current.logo_files],
    handles: [...current.handles],
    voice: { ...current.voice, dos: [...current.voice.dos], donts: [...current.voice.donts] },
  }
  let changed = false

  if (!out.voice.tone) {
    const tone = deriveVoiceTone(answers)
    if (tone) { out.voice.tone = tone; changed = true }
  }
  if (out.voice.dos.length === 0) {
    const words = splitWords(answerText(answers, 'three_words'))
    if (words.length) { out.voice.dos = words; changed = true }
  }
  if (out.voice.donts.length === 0) {
    const words = splitWords(answerText(answers, 'never_words'))
    if (words.length) { out.voice.donts = words; changed = true }
  }
  if (out.handles.length === 0) {
    const handles = extractHandles(answerText(answers, 'socials'))
    if (handles.length) { out.handles = handles; changed = true }
  }
  if (out.logo_files.length === 0 && brandFiles.length) {
    out.logo_files = brandFiles
    changed = true
  }
  if (!out.notes.trim()) {
    const lines: string[] = []
    const tagline = answerText(answers, 'tagline')
    const website = answerText(answers, 'website')
    if (tagline) lines.push(`Tagline: ${tagline}`)
    if (website) lines.push(`Website: ${website}`)
    if (lines.length) { out.notes = lines.join('\n'); changed = true }
  }

  return { profile: out, changed }
}

// ── the AI gate ─────────────────────────────────────────────────────────────

/** The relevant free-text answers, condensed into the prompt for the voice
 *  summary. Empty when nothing worth summarising was written. */
export function voiceSummarySources(answers: Answers): { id: string; text: string }[] {
  return VOICE_SOURCE_IDS
    .map(id => ({ id, text: answerText(answers, id) }))
    .filter(a => a.text.length > 0)
}

/** The unmapped free-text answers — where a name/email would hide if a template
 *  were custom-edited so the standard contact fields no longer exist. Capped so
 *  one odd form cannot balloon the prompt. */
export function extraAnswers(answers: Answers, max = 12): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = []
  for (const [id, raw] of Object.entries(answers ?? {})) {
    if (MAPPED_IDS.has(id) || (VOICE_SOURCE_IDS as readonly string[]).includes(id)) continue
    const text = Array.isArray(raw) ? raw.map(String).join(', ').trim() : String(raw ?? '').trim()
    if (!text) continue
    out.push({ id, text: text.slice(0, 500) })
    if (out.length >= max) break
  }
  return out
}

export type EnrichmentPlan = {
  /** condense the free-text into voice.summary — summary blank AND sources exist */
  aiVoiceNeeded: boolean
  /** mine the unmapped answers for a name/email — no contact resolved AND extras exist */
  aiContactNeeded: boolean
  /** true when EITHER fuzzy job is worth a model call; false → skip the AI entirely */
  aiNeeded: boolean
  voiceSources: { id: string; text: string }[]
  extras: { id: string; text: string }[]
}

/**
 * Decide whether the one Haiku call is worth making. This is the whole token
 * saving: when the voice summary is already written (or nothing was said) AND a
 * contact is resolved deterministically, the model is never called.
 *
 * @param contactResolved a primary contact already exists or was derived from
 *        the standard fields — so the AI is not needed to find one.
 */
export function planEnrichment(
  answers: Answers,
  current: BrandProfile,
  contactResolved: boolean,
): EnrichmentPlan {
  const voiceSources = voiceSummarySources(answers)
  const extras = extraAnswers(answers)
  const aiVoiceNeeded = !current.voice.summary.trim() && voiceSources.length > 0
  const aiContactNeeded = !contactResolved && extras.length > 0
  return {
    aiVoiceNeeded,
    aiContactNeeded,
    aiNeeded: aiVoiceNeeded || aiContactNeeded,
    voiceSources,
    extras,
  }
}
