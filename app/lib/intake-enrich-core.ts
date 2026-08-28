/**
 * Pure intake → client enrichment core — no I/O, fully unit-testable.
 *
 * When an intake form is submitted we fill the client's primary CONTACT and
 * their BRAND profile from the answers, but ONLY where those are still empty —
 * a re-submit, or a later run, must never overwrite a hand edit.
 *
 * Two layers:
 *   1. a DETERMINISTIC fast-path for the truly 1:1 fields (the tone SELECT, an
 *      explicit "Full name, Title" primary_contact, three_words → dos, etc.).
 *      These cost nothing.
 *   2. a SMART layer — one Haiku call — for everything fuzzy or template-
 *      specific: a contact buried in prose, socials given as URLs, tone
 *      described in a paragraph, a voice summary. This file decides WHEN that
 *      call is worth making (only when a target is still empty AND a plausible
 *      source answer exists) and prepares the labelled answers it is fed.
 *
 * Everything here is a pure function over the answers and the CURRENT profile.
 * The database work and the model call live in intake-enrich.ts.
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

/** The block ids the deterministic pass reads 1:1. Not load-bearing for the AI,
 *  which works off question LABELS so it is template-agnostic. */
export const MAPPED_IDS = new Set<string>([
  'primary_contact', 'contact_email', 'contact_mobile', 'best_call_window',
  'day_to_day_contact',
  'three_words', 'never_words', 'tone', 'tagline', 'socials',
  'brand_files', 'public_name', 'website',
])

/** Free-text blocks that hold a contact but not in tidy fields — the ongoing
 *  retainer template has no primary_contact/contact_email at all; the person
 *  lives in `day_to_day_contact` as name + phone + email run together. Used for
 *  the deterministic fallback when the model is unavailable. */
export const CONTACT_SOURCE_IDS = ['day_to_day_contact'] as const

// ── contact (deterministic fast-path) ───────────────────────────────────────

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

/** The primary contact the STANDARD structured fields describe, or null when
 *  there is nothing usable. The ongoing template has none of these fields — its
 *  contact is handled by the AI / free-text fallback below. */
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

/** The first email anywhere in a blob of text, else ''. */
export function extractEmail(text: string): string {
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
  return m ? m[0] : ''
}

/** The first phone-looking run of digits anywhere in the text, else ''. Kept
 *  loose (spaces, +, brackets, dashes) so an Australian mobile written any of
 *  the usual ways is caught. */
export function extractPhone(text: string): string {
  const m = text.match(/\+?\d[\d\s()-]{6,}\d/)
  return m ? m[0].replace(/\s+/g, ' ').trim() : ''
}

/**
 * Last-resort deterministic contact from a free-text blob (e.g. Turnkey's
 * "Jordan Wilson\n0488 420 104\njordan@tkbg.com.au"). Used only when the model
 * is unavailable — email and phone are reliable by regex; the name is the first
 * line that is neither, capped so a "Myself and Cadell for day-to-day…" clause
 * does not become a paragraph. The AI does this far better when it runs.
 */
export function deriveContactFromFreeText(text: string): DerivedContact | null {
  const email = extractEmail(text)
  const phone = extractPhone(text)
  let name = ''
  for (const raw of text.split(/[\n,]/)) {
    const c = raw.trim()
    if (!c || extractEmail(c) || /\d{5,}/.test(c)) continue
    name = c.replace(/\s+/g, ' ').split(' ').slice(0, 4).join(' ')
    break
  }
  if (!name && !email) return null
  return { name, role: '', email, phone, notes: '' }
}

// ── brand (deterministic fast-path) ─────────────────────────────────────────

/** The three tone options become a short phrase. An unrecognised (custom-
 *  edited) value passes through as itself. */
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

/** Turn one URL (with or without a protocol) into a bare handle: the first
 *  meaningful path segment, skipping Facebook's `p`/`pages`/`profile.php`
 *  wrappers, else the domain's second-level name. */
function handleFromUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return ''
  }
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts.length === 0) {
    const host = u.hostname.replace(/^www\./i, '')
    return host.split('.')[0] ?? ''
  }
  let seg = parts[0]
  if (/^(p|pages|people|profile\.php)$/i.test(seg) && parts[1]) seg = parts[1]
  try { seg = decodeURIComponent(seg) } catch { /* leave as-is */ }
  return seg.replace(/^@/, '').trim()
}

/** One socials segment → its handles. Handles a URL (stripped to its @handle),
 *  explicit @mentions, or a bare name with a trailing "(Instagram)" / "on
 *  Instagram" note. A leftover phrase (no handle in it) is dropped, never
 *  stored as a raw URL. */
function handlesFromSegment(seg: string): string[] {
  let s = seg.trim()
  if (!s) return []
  // a URL anywhere in the segment → one handle from it
  const url = s.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S+/i)
  if (url) {
    const h = handleFromUrl(url[0])
    return h ? [asHandle(h)].filter(Boolean) : []
  }
  // explicit @handles win
  const ats = s.match(/@[A-Za-z0-9_.]+/g)
  if (ats && ats.length) return ats.map(asHandle).filter(Boolean)
  // drop a trailing platform note, then require a single clean token
  s = s.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+on\s+[a-z0-9 ]+$/i, '').trim()
  if (!s || /\s/.test(s)) return []
  const h = asHandle(s)
  return h ? [h] : []
}

/** Clean handles out of a socials answer, which in the wild is a mix of
 *  @handles, bare names with "(Instagram)" labels, and full profile URLs. One
 *  per platform, deduped, never a raw URL. */
export function extractHandles(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const seg of raw.split(/[,\n;]+/)) {
    for (const h of handlesFromSegment(seg)) {
      const key = h.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(h)
    }
  }
  return out
}

/**
 * Additive, empty-only merge of the DETERMINISTIC brand answers into `current`,
 * plus a flag saying whether anything was filled. Never overwrites. The fuzzy
 * fields (voice.summary, and anything the AI cleans up) are folded in
 * separately by the caller.
 */
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

// ── the AI gate (smart layer) ───────────────────────────────────────────────

export type LabeledAnswer = { id: string; label: string; value: string }

/** The answers as {id, label, value}, dropping empties. The AI is fed labels,
 *  not ids, so it understands any template's wording. */
export function toLabeledAnswers(answers: Answers, labels: Map<string, string>): LabeledAnswer[] {
  const out: LabeledAnswer[] = []
  for (const [id, raw] of Object.entries(answers ?? {})) {
    const value = Array.isArray(raw)
      ? raw.map(x => String(x ?? '').trim()).filter(Boolean).join(', ')
      : String(raw ?? '').trim()
    if (!value) continue
    out.push({ id, label: labels.get(id) ?? id, value })
  }
  return out
}

const CONTACT_HINT = /contact|people|person|founder|owner|team|approv|sign|coordinat|day.to.day|manage|director|principal|reach/i
const BRAND_HINT = /voice|tone|word|feel|brand|admire|percept|position|remember|misconcep|social|instagram|handle|tagline|slogan|comms|communicat|personality|story|mission|value|describe/i

/** The answers worth sending to the model: anything whose id OR question label
 *  looks contact- or brand/voice-related, capped and truncated so one odd form
 *  cannot balloon the prompt. Label-driven, so it works on every template. */
export function selectRelevantAnswers(labeled: LabeledAnswer[], max = 24): LabeledAnswer[] {
  const out: LabeledAnswer[] = []
  for (const a of labeled) {
    const hay = `${a.id} ${a.label}`
    if (CONTACT_HINT.test(hay) || BRAND_HINT.test(hay)) {
      out.push({ ...a, value: a.value.slice(0, 600) })
      if (out.length >= max) break
    }
  }
  return out
}

export type MissingTargets = {
  contact: boolean
  tone: boolean
  dos: boolean
  donts: boolean
  summary: boolean
  handles: boolean
}

/** What is STILL empty after the deterministic pass — the fields the AI could
 *  usefully fill. */
export function missingTargets(profile: BrandProfile, contactResolved: boolean): MissingTargets {
  return {
    contact: !contactResolved,
    tone: !profile.voice.tone.trim(),
    dos: profile.voice.dos.length === 0,
    donts: profile.voice.donts.length === 0,
    summary: !profile.voice.summary.trim(),
    handles: profile.handles.length === 0,
  }
}

export type EnrichmentPlan = {
  /** true when SOME target is still empty AND there is a plausible source to
   *  read from — the only case where the model is worth calling. */
  aiNeeded: boolean
  missing: MissingTargets
  /** the labelled answers to feed the one Haiku call */
  relevant: LabeledAnswer[]
}

/**
 * Decide whether the one Haiku call is worth making. This is the whole token
 * saving: pass the profile AFTER the deterministic fill, and when nothing is
 * still missing (or there is no relevant answer to read), the model is never
 * called.
 */
export function planEnrichment(
  profileAfterDeterministic: BrandProfile,
  contactResolved: boolean,
  labeled: LabeledAnswer[],
): EnrichmentPlan {
  const missing = missingTargets(profileAfterDeterministic, contactResolved)
  const anyMissing =
    missing.contact || missing.tone || missing.dos || missing.donts || missing.summary || missing.handles
  const relevant = selectRelevantAnswers(labeled)
  return { aiNeeded: anyMissing && relevant.length > 0, missing, relevant }
}
