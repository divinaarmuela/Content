import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { supabase } from '@/lib/supabase'
import { inngest } from '../inngest/client'
import { listIntakeFiles, type IntakeForm } from './intake'
import { intakeFileTarget } from './gdrive-core'
import { mirrorBrandDoc } from './gdrive-mirror'
import { loadBrandProfile } from './brand-profile'
import { normaliseProfile, type BrandFile, type BrandProfile } from './brand-profile-core'
import {
  deriveContact, deriveBrandFill, planEnrichment, toLabeledAnswers,
  deriveContactFromFreeText, answerText, CONTACT_SOURCE_IDS,
  type DerivedContact, type LabeledAnswer,
} from './intake-enrich-core'
import type { Answers, TemplateDefinition } from './intake-core'

/**
 * Enrich a client from a submitted intake form: fill the primary CONTACT and
 * the BRAND profile, but ONLY where those are still empty. Mostly deterministic
 * (intake-enrich-core.ts maps a block id → a field); one Haiku call handles the
 * fuzzy bits (a voice summary, and a name/email out of a custom-edited template)
 * and only when a target field is blank — when nothing fuzzy is missing the
 * model is never called.
 *
 * Best-effort throughout: the answers are already saved and the client has done
 * their part, so nothing here may turn a successful submission into an error.
 * Idempotent by construction — every write is gated on a field being empty, so
 * a re-submit or a retry fills nothing and overwrites no hand edit.
 */

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY

/** One comprehensive, Zod-validated extraction. Every field is optional in
 *  spirit — empty string / empty array whenever the answers do not clearly
 *  contain it. The model is told to clean and normalise, never to invent. */
const Extraction = z.object({
  contact: z.object({
    name: z.string().describe('Full name of the single PRIMARY day-to-day contact, if a person is clearly named. If two or more people are named, pick the clearest primary. Empty if none.'),
    role: z.string().describe('Their job title or role, if given (e.g. "Managing Director"), else empty'),
    email: z.string().describe('Their email address, pulled from anywhere in the text, else empty'),
    phone: z.string().describe('Their phone number, pulled from anywhere in the text, else empty'),
  }),
  handles: z.array(z.string()).describe('Social media handles, cleaned to "@handle" form, one per platform. Strip full URLs down to the handle. NEVER return a raw URL. Empty array if none.'),
  voice: z.object({
    tone: z.string().describe('The brand tone of voice as a SHORT phrase (e.g. "Warm and family"), even if the client described it in a paragraph. Empty if not stated.'),
    dos: z.array(z.string()).describe('Words/qualities the brand SHOULD feel like — short words or phrases. Empty array if none.'),
    donts: z.array(z.string()).describe('Words/qualities the brand should NEVER feel like. Empty array if none.'),
    summary: z.string().describe('A warm, 1-2 sentence summary of the brand voice and personality, drawn ONLY from what the client wrote. Empty if there is nothing to summarise.'),
  }),
  tagline: z.string().describe('An explicit tagline or signature phrase, if the client gave one, else empty'),
})
type ExtractionT = z.infer<typeof Extraction>

export type EnrichResult = {
  contact: 'created' | 'exists' | 'none'
  brand: 'updated' | 'unchanged'
  ai: 'called' | 'skipped'
  /** whether a brand-guide PDF was handed to the existing deep scanner */
  brand_scan: 'queued' | 'skipped'
}

/** The intake answers + definition + template for one form, or null. */
async function loadForm(formId: string, clientId: string): Promise<IntakeForm | null> {
  const { data } = await supabase
    .from('intake_forms')
    .select('id, client_id, title, template_key, definition, token, status, answers, sent_at, first_opened_at, submitted_at, reopened_at, notify_emails')
    .eq('id', formId).eq('client_id', clientId).maybeSingle()
  return (data as unknown as IntakeForm) ?? null
}

/** The brand/logo files uploaded against this form, as {name, url}. A file is
 *  brand material because of the QUESTION it answered, not its own name — so we
 *  read the block via intakeFileTarget (label pulled from the definition). */
async function brandFilesFor(form: IntakeForm): Promise<BrandFile[]> {
  const labels = new Map<string, string>()
  for (const section of (form.definition as TemplateDefinition).sections) {
    for (const block of section.blocks) labels.set(block.id, block.label ?? '')
  }
  const files = await listIntakeFiles(form.id)
  return files
    .filter(f => intakeFileTarget(f.block_id, labels.get(f.block_id) ?? '') === 'brand')
    .map(f => ({ name: f.filename, url: f.url }))
}

/**
 * Insert one primary contact, but only if the client has none matching. Match
 * on email (case-insensitive), else on name — so a re-submit never doubles a
 * person. `is_primary` is set only when the client has no primary yet; the
 * partial unique index otherwise 409s, and we fall back to a non-primary row.
 * Returns whether a contact was created or already existed.
 */
async function upsertPrimaryContact(clientId: string, contact: DerivedContact): Promise<'created' | 'exists'> {
  const { data: existing } = await supabase
    .from('client_contacts').select('id, name, email, is_primary').eq('client_id', clientId)
  const rows = existing ?? []

  const email = contact.email.trim().toLowerCase()
  const name = contact.name.trim().toLowerCase()
  const match = rows.find(r =>
    (email && String(r.email ?? '').trim().toLowerCase() === email) ||
    (!email && name && String(r.name ?? '').trim().toLowerCase() === name))
  if (match) return 'exists'

  const hasPrimary = rows.some(r => r.is_primary === true)
  const base = {
    client_id: clientId,
    name: contact.name || contact.email || 'Primary contact',
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
    notes: contact.notes,
  }

  const { error } = await supabase
    .from('client_contacts').insert({ ...base, is_primary: !hasPrimary })
  if (error) {
    // someone else set a primary between our read and write — take a
    // non-primary row rather than losing the contact
    if (error.message.includes('client_contacts_one_primary')) {
      const { error: retry } = await supabase
        .from('client_contacts').insert({ ...base, is_primary: false })
      if (retry) throw new Error(retry.message)
      return 'created'
    }
    throw new Error(error.message)
  }
  return 'created'
}

/** Write the merged brand profile with the same optimistic-concurrency guard on
 *  `rev` the editor uses. Retries once on conflict by re-reading and re-merging,
 *  so a concurrent scan or edit is folded in rather than clobbered. */
async function writeBrandProfile(
  clientId: string,
  build: (current: BrandProfile) => { profile: BrandProfile; changed: boolean },
): Promise<'updated' | 'unchanged'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // Read the ACTUAL persisted column, not loadBrandProfile — that returns a
    // synthetic rev of 1 for an unsaved profile while the column is still null,
    // and guarding on rev=1 against a null column matches zero rows, so the
    // write silently never lands. The guard must reflect what is really stored:
    // a null column (never saved) vs the exact rev of an existing profile.
    const { data: row } = await supabase
      .from('clients').select('brand_profile').eq('id', clientId).maybeSingle()
    if (!row) return 'unchanged'

    const raw = (row as { brand_profile: unknown }).brand_profile
    const hadProfile = raw != null
    const current = normaliseProfile(raw ?? {})
    const { profile, changed } = build(current)
    if (!changed) return 'unchanged'

    // normaliseProfile carries a stored rev through; 0 means the column is null
    const seen = hadProfile ? current.rev : 0
    const next: BrandProfile = { ...normaliseProfile(profile), rev: seen + 1 }
    let q = supabase.from('clients')
      .update({
        brand_profile: next,
        brand_profile_updated_at: new Date().toISOString(),
        brand_profile_updated_by: 'intake enrichment',
      })
      .eq('id', clientId)
    // the row must still be where we merged from: a null column stays null, an
    // existing one stays at its rev — a concurrent scan or edit fails the guard
    q = hadProfile ? q.eq('brand_profile->>rev', String(seen)) : q.is('brand_profile', null)
    const { data, error } = await q.select('id')
    if (error) throw new Error(error.message)
    if (data && data.length > 0) return 'updated'
    // conflict: loop once to re-read and re-merge onto the newer profile
  }
  return 'unchanged'
}

export async function enrichFromIntake(input: { formId: string; clientId: string }): Promise<EnrichResult> {
  const { formId, clientId } = input
  const result: EnrichResult = { contact: 'none', brand: 'unchanged', ai: 'skipped', brand_scan: 'skipped' }

  const form = await loadForm(formId, clientId)
  if (!form) return result
  const answers = (form.answers ?? {}) as Answers

  // question labels, so the AI understands each answer regardless of template
  const labels = new Map<string, string>()
  for (const section of (form.definition as TemplateDefinition).sections) {
    for (const block of section.blocks) labels.set(block.id, block.label ?? '')
  }
  const labeled: LabeledAnswer[] = toLabeledAnswers(answers, labels)

  // ── contact: deterministic fast-path (the structured primary_contact block) ──
  const derived = deriveContact(answers)
  let contactResolved = false
  if (derived) {
    try {
      result.contact = await upsertPrimaryContact(clientId, derived)
      contactResolved = true
    } catch (e) {
      console.error('intake enrich: contact insert failed:', e)
    }
  }
  // an existing contact also counts as resolved — nothing to fill
  if (!contactResolved) {
    const { data: anyContact } = await supabase
      .from('client_contacts').select('id').eq('client_id', clientId).limit(1)
    if (anyContact && anyContact.length > 0) {
      contactResolved = true
      if (result.contact === 'none') result.contact = 'exists'
    }
  }

  const brandFiles = await brandFilesFor(form).catch(e => {
    console.error('intake enrich: brand files failed:', e)
    return [] as BrandFile[]
  })

  // ── decide whether the ONE Haiku call is worth making ──
  // Plan against the profile AS IT WILL BE after the deterministic fill, so the
  // AI is only asked for what the fast-path could not supply. If a target is
  // still empty AND a relevant answer exists → call once; otherwise skip.
  const loaded = await loadBrandProfile(clientId, 'intake enrichment')
  const currentProfile = loaded?.profile ?? normaliseProfile({})
  const afterDeterministic = deriveBrandFill(answers, brandFiles, currentProfile).profile
  const plan = planEnrichment(afterDeterministic, contactResolved, labeled)

  let extracted: ExtractionT | null = null
  if (plan.aiNeeded) {
    try {
      extracted = await extractAll(plan.relevant)
      result.ai = 'called'
    } catch (e) {
      console.error('intake enrich: AI extraction failed:', e)
    }
  }

  // ── contact from the AI (any template), else a deterministic free-text
  //    fallback over day_to_day_contact — only when nothing resolved one ──
  if (!contactResolved) {
    let candidate: DerivedContact | null = null
    if (extracted && (extracted.contact.name.trim() || extracted.contact.email.trim())) {
      candidate = {
        name: extracted.contact.name.trim() || extracted.contact.email.trim(),
        role: extracted.contact.role.trim(),
        email: extracted.contact.email.trim(),
        phone: extracted.contact.phone.trim(),
        notes: '',
      }
    } else {
      const srcText = CONTACT_SOURCE_IDS.map(id => answerText(answers, id)).filter(Boolean).join('\n')
      candidate = srcText ? deriveContactFromFreeText(srcText) : null
    }
    if (candidate) {
      try {
        result.contact = await upsertPrimaryContact(clientId, candidate)
        contactResolved = true
      } catch (e) {
        console.error('intake enrich: contact insert (AI/fallback) failed:', e)
      }
    }
  }

  // ── brand write: deterministic fill + the AI's cleaned fields, all
  //    fill-only-if-empty, normalised, rev-guarded ──
  try {
    result.brand = await writeBrandProfile(clientId, current => {
      const det = deriveBrandFill(answers, brandFiles, current)
      let { profile } = det
      let changed = det.changed
      if (extracted) {
        const add = applyAiBrand(profile, extracted)
        profile = add.profile
        changed = changed || add.changed
      }
      return { profile, changed }
    })
  } catch (e) {
    console.error('intake enrich: brand write failed:', e)
  }

  // ── a brand-guide PDF is deep-scanned by the EXISTING pipeline, not here ──
  // Linking the files into logo_files (above) is cheap; extracting colours,
  // fonts and logo rules from a 34-page guide is minutes of vision calls, and
  // that scanner already exists and is proven. We only hand it the document —
  // never re-implement PDF reading in the enrichment.
  try {
    result.brand_scan = await maybeDelegateBrandScan(clientId, brandFiles)
  } catch (e) {
    console.error('intake enrich: brand scan delegation failed:', e)
  }

  return result
}

/**
 * If the client uploaded a brand-guide PDF and has no extracted brand yet, hand
 * it to the existing `app/brand.scan.requested` pipeline — the same dispatch the
 * brand panel's "scan" action uses. Best-effort and heavily gated: skipped when
 * there is no PDF, when the client already has colours or fonts, or when a scan
 * has already run or is in flight (so a re-run never re-scans a done client).
 */
async function maybeDelegateBrandScan(clientId: string, brandFiles: BrandFile[]): Promise<'queued' | 'skipped'> {
  const pdf = brandFiles.find(f => /\.pdf(\?|$)/i.test(f.url) || /\.pdf$/i.test(f.name))
  if (!pdf) return 'skipped'

  const [{ data: client }, { data: brand }] = await Promise.all([
    supabase.from('clients').select('brand_profile').eq('id', clientId).maybeSingle(),
    supabase.from('client_brand').select('profile, docs, scan_status').eq('client_id', clientId).maybeSingle(),
  ])

  // already has a brand → don't re-scan
  const prof = normaliseProfile((client?.brand_profile as unknown) ?? {})
  if (prof.colours.length > 0 || prof.fonts.length > 0) return 'skipped'
  const scanProfile = (brand?.profile ?? null) as Record<string, unknown> | null
  if (scanProfile && Object.keys(scanProfile).length > 0) return 'skipped'
  // a scan already run or in flight → don't queue another
  if (brand?.scan_status && ['queued', 'scanning', 'done'].includes(String(brand.scan_status))) return 'skipped'
  if (Array.isArray(brand?.docs) && brand.docs.length > 0) return 'skipped'

  // mark it queued before dispatching, exactly like the brand panel's action,
  // so the panel shows a scan in flight immediately
  await supabase.from('client_brand').upsert({
    client_id: clientId, scan_status: 'queued', scan_done: 0, scan_total: 1, scan_message: null,
  })
  await inngest.send({
    name: 'app/brand.scan.requested',
    data: { clientId, url: pdf.url, filename: pdf.name, by: 'intake enrichment' },
  })
  // the guide belongs in the client's _Brand folder; idempotent by
  // unique(source_url, target), so a file already mirrored on submit is a no-op
  mirrorBrandDoc(clientId, pdf.url, pdf.name)
  return 'queued'
}

/** Fold the AI's cleaned fields into the profile, fill-only-if-empty. Returns a
 *  new profile and whether anything changed. normaliseProfile (in the writer)
 *  does the final cleaning — @-prefixing handles, deduping, capping. */
function applyAiBrand(profile: BrandProfile, ai: ExtractionT): { profile: BrandProfile; changed: boolean } {
  const out: BrandProfile = {
    ...profile,
    handles: [...profile.handles],
    voice: { ...profile.voice, dos: [...profile.voice.dos], donts: [...profile.voice.donts] },
  }
  let changed = false
  if (!out.voice.tone.trim() && ai.voice.tone.trim()) { out.voice.tone = ai.voice.tone.trim(); changed = true }
  if (out.voice.dos.length === 0 && ai.voice.dos.length) { out.voice.dos = ai.voice.dos; changed = true }
  if (out.voice.donts.length === 0 && ai.voice.donts.length) { out.voice.donts = ai.voice.donts; changed = true }
  if (!out.voice.summary.trim() && ai.voice.summary.trim()) { out.voice.summary = ai.voice.summary.trim(); changed = true }
  if (out.handles.length === 0 && ai.handles.length) { out.handles = ai.handles; changed = true }
  if (!out.notes.trim() && ai.tagline.trim()) { out.notes = `Tagline: ${ai.tagline.trim()}`; changed = true }
  return { profile: out, changed }
}

/**
 * The one smart Haiku call. Reuses the email-lead pattern (messages.parse + a
 * Zod schema, empty for unknowns, best-effort). Sends the relevant answers WITH
 * their question labels — so the model works across every template — and asks
 * for one clean, structured, normalised extraction. Never the whole form.
 */
async function extractAll(relevant: LabeledAnswer[]): Promise<ExtractionT | null> {
  const body = relevant.map(a => `Q: ${a.label || a.id}\nA: ${a.value}`).join('\n\n')
  const response = await anthropic.messages.parse({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    system:
      'You clean up a new client\'s intake answers for MD Media, a Melbourne marketing agency. ' +
      'From the questions and answers below, extract ONLY what is clearly present — NEVER invent or infer beyond the text. ' +
      'Normalise as you go: ' +
      'if a person is named with a title, split it into name and role; ' +
      'pull an email and a phone number from anywhere in the text; ' +
      'if two or more people are named, choose the single clearest PRIMARY day-to-day contact; ' +
      'return social handles as clean "@handle" values, one per platform, and strip any full URL down to the handle — never return a raw URL; ' +
      'give the tone as a short phrase even if it was described in a paragraph. ' +
      'Use empty strings and empty arrays for anything not clearly there. Prefer precision over guessing.',
    messages: [{ role: 'user', content: `Client intake answers (question → answer):\n\n${body || '(no answers)'}` }],
    output_config: { format: zodOutputFormat(Extraction) },
  })
  return response.parsed_output ?? null
}
