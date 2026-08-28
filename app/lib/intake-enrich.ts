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
  deriveContact, deriveBrandFill, planEnrichment, type DerivedContact,
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

const Extraction = z.object({
  voice_summary: z.string().describe(
    'A warm, 1-2 sentence summary of the brand voice and personality, drawn ONLY from what the client wrote. Empty string if there is nothing to summarise.',
  ),
  contact_name: z.string().describe('Full name of the primary contact if one appears in the answers, else empty'),
  contact_email: z.string().describe('Email address of the primary contact if one appears in the answers, else empty'),
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

  // ── contact (deterministic) ──
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
  // even with no derived contact, an existing one counts as resolved
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

  // ── decide whether the AI is worth a call ──
  const loaded = await loadBrandProfile(clientId, 'intake enrichment')
  const currentProfile = loaded?.profile ?? normaliseProfile({})
  const plan = planEnrichment(answers, currentProfile, contactResolved)

  let extracted: ExtractionT | null = null
  if (plan.aiNeeded) {
    try {
      extracted = await extractFuzzy(plan.voiceSources, plan.aiContactNeeded ? plan.extras : [])
      result.ai = 'called'
    } catch (e) {
      console.error('intake enrich: AI extraction failed:', e)
    }
  }

  // ── an AI-found contact, only when nothing resolved one already ──
  if (!contactResolved && extracted && (extracted.contact_name.trim() || extracted.contact_email.trim())) {
    try {
      result.contact = await upsertPrimaryContact(clientId, {
        name: extracted.contact_name.trim(),
        role: '',
        email: extracted.contact_email.trim(),
        phone: '',
        notes: '',
      })
    } catch (e) {
      console.error('intake enrich: AI contact insert failed:', e)
    }
  }

  // ── brand write (deterministic fill + AI voice summary), rev-guarded ──
  const aiSummary = plan.aiVoiceNeeded ? (extracted?.voice_summary.trim() ?? '') : ''
  try {
    result.brand = await writeBrandProfile(clientId, current => {
      const { profile, changed: detChanged } = deriveBrandFill(answers, brandFiles, current)
      let changed = detChanged
      if (aiSummary && !profile.voice.summary.trim()) {
        profile.voice = { ...profile.voice, summary: aiSummary }
        changed = true
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

/** One Haiku call for the fuzzy bits. Reuses the email-lead pattern: parse into
 *  a Zod schema, empty-string discipline for unknowns, best-effort. Sends ONLY
 *  the relevant answers, never the whole form. */
async function extractFuzzy(
  voiceSources: { id: string; text: string }[],
  extras: { id: string; text: string }[],
): Promise<ExtractionT | null> {
  const parts: string[] = []
  if (voiceSources.length) {
    parts.push(
      'Free-text answers about the brand (for the voice summary):\n' +
      voiceSources.map(a => `- ${a.text}`).join('\n'),
    )
  }
  if (extras.length) {
    parts.push(
      'Other answers (a primary contact name/email may be somewhere in here):\n' +
      extras.map(a => `- ${a.id}: ${a.text}`).join('\n'),
    )
  }
  const response = await anthropic.messages.parse({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system:
      'You help MD Media, a Melbourne marketing agency, tidy up a new client intake. ' +
      'Write a short brand-voice summary from what the client actually wrote, and extract a primary contact name/email only if one is genuinely present. ' +
      'Never invent anything — use empty strings for anything not clearly in the text.',
    messages: [{ role: 'user', content: parts.join('\n\n') || '(no answers)' }],
    output_config: { format: zodOutputFormat(Extraction) },
  })
  return response.parsed_output ?? null
}
