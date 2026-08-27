/**
 * The editable brand profile — pure, no I/O, unit-tested.
 *
 * The scan (brand-core.ts) is a READ of a PDF: whatever the model found, in
 * the model's shape. This is the profile the team actually keeps: seeded from
 * that scan once, then edited by hand, and never overwritten by a later scan.
 * A re-scan proposes additions; a person accepts or ignores them.
 *
 * Two shapes, one bridge: `fromScan` seeds a profile from a scan result and
 * `toScanShape` renders a profile back into the scan's shape for everything
 * that already reads it (the production brand card, the portal theme).
 */

import type { BrandProfile as ScanProfile } from './brand-core'

export const COLOUR_ROLES = ['primary', 'secondary', 'accent', 'background', 'text'] as const
export type ColourRole = typeof COLOUR_ROLES[number]
export const COLOUR_ROLE_LABEL: Record<ColourRole, string> = {
  primary: 'Main', secondary: 'Second', accent: 'Accent', background: 'Background', text: 'Text',
}

export const FONT_ROLES = ['heading', 'body'] as const
export type FontRole = typeof FONT_ROLES[number]
export const FONT_ROLE_LABEL: Record<FontRole, string> = { heading: 'Headings', body: 'Body text' }

export type BrandColour = { name: string; hex: string; role: ColourRole }
export type BrandFont = { name: string; role: FontRole; url?: string }
export type BrandFile = { name: string; url: string }

export type BrandProfile = {
  version: 1
  /** bumps on every save — the write is refused when it does not match */
  rev: number
  colours: BrandColour[]
  fonts: BrandFont[]
  logo_rules: string[]
  logo_files: BrandFile[]
  voice: { summary: string; tone: string; dos: string[]; donts: string[] }
  hashtags: string[]
  handles: string[]
  notes: string
  /** `client_brand.updated_at` of the last scan folded in or reviewed; a
   *  newer scan than this has changes waiting to be looked at */
  reviewed_scan_at: string | null
}

export const MAX_ITEMS = 100
export const MAX_TEXT = 600
export const MAX_NOTES = 4000

export function emptyProfile(): BrandProfile {
  return {
    version: 1, rev: 0, colours: [], fonts: [], logo_rules: [], logo_files: [],
    voice: { summary: '', tone: '', dos: [], donts: [] },
    hashtags: [], handles: [], notes: '', reviewed_scan_at: null,
  }
}

/** '#1a2b3c', '1A2B3C', '#abc' → '#1A2B3C'; anything else → null. */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v.toUpperCase()}`
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${v.split('').map(c => c + c).join('').toUpperCase()}`
  return null
}

const text = (v: unknown, max = MAX_TEXT): string =>
  (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().replace(/\s+/g, ' ').slice(0, max)

const paragraph = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max)

/** Trimmed, non-empty, unique (case-insensitive, first wins), capped. */
export function dedupeText(list: unknown, map: (s: string) => string = s => s): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const s = map(text(raw))
    const key = s.toLowerCase()
    if (!s || seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

export const asHashtag = (s: string): string => {
  const v = s.trim().replace(/^#+/, '').replace(/\s+/g, '')
  return v ? `#${v}` : ''
}
export const asHandle = (s: string): string => {
  const v = s.trim().replace(/^@+/, '').replace(/\s+/g, '')
  return v ? `@${v}` : ''
}

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s)

const roleOf = <T extends string>(v: unknown, roles: readonly T[], fallback: T): T =>
  roles.includes(String(v ?? '').toLowerCase() as T) ? (String(v).toLowerCase() as T) : fallback

/**
 * Force any input into a valid profile: bad hexes are dropped, duplicates
 * collapse (colour by hex, font by name, file by url, rules by text), lists
 * are capped, roles fall back. Never throws — this is what gets stored.
 */
export function normaliseProfile(raw: unknown): BrandProfile {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = emptyProfile()
  out.rev = Number.isFinite(Number(p.rev)) ? Math.max(0, Math.floor(Number(p.rev))) : 0

  const seenHex = new Set<string>()
  for (const c of Array.isArray(p.colours) ? p.colours : []) {
    const o = (c ?? {}) as Record<string, unknown>
    const hex = normaliseHex(o.hex)
    if (!hex || seenHex.has(hex)) continue
    seenHex.add(hex)
    out.colours.push({ name: text(o.name, 80), hex, role: roleOf(o.role, COLOUR_ROLES, 'secondary') })
    if (out.colours.length >= MAX_ITEMS) break
  }

  const seenFont = new Set<string>()
  for (const f of Array.isArray(p.fonts) ? p.fonts : []) {
    const o = (f ?? {}) as Record<string, unknown>
    const name = text(o.name, 80)
    const key = name.toLowerCase()
    if (!name || seenFont.has(key)) continue
    seenFont.add(key)
    const url = text(o.url, 500)
    out.fonts.push({ name, role: roleOf(o.role, FONT_ROLES, 'body'), ...(isUrl(url) ? { url } : {}) })
    if (out.fonts.length >= MAX_ITEMS) break
  }

  out.logo_rules = dedupeText(p.logo_rules)

  const seenUrl = new Set<string>()
  for (const f of Array.isArray(p.logo_files) ? p.logo_files : []) {
    const o = (f ?? {}) as Record<string, unknown>
    const url = text(o.url, 1000)
    if (!isUrl(url) || seenUrl.has(url)) continue
    seenUrl.add(url)
    out.logo_files.push({ name: text(o.name, 120) || url.split('/').pop() || 'file', url })
    if (out.logo_files.length >= MAX_ITEMS) break
  }

  const v = (p.voice && typeof p.voice === 'object' ? p.voice : {}) as Record<string, unknown>
  out.voice = {
    summary: paragraph(v.summary, MAX_NOTES),
    tone: text(v.tone, 200),
    dos: dedupeText(v.dos),
    donts: dedupeText(v.donts),
  }
  out.hashtags = dedupeText(p.hashtags, asHashtag)
  out.handles = dedupeText(p.handles, asHandle)
  out.notes = paragraph(p.notes, MAX_NOTES)
  out.reviewed_scan_at = typeof p.reviewed_scan_at === 'string' && p.reviewed_scan_at ? p.reviewed_scan_at : null
  return out
}

/**
 * Strict check for the API: says WHAT is wrong, in words a person can act on.
 * `normaliseProfile` silently drops a bad hex; a save must not.
 */
export function validateProfile(raw: unknown): { ok: true; profile: BrandProfile } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Send the brand profile as an object' }
  const p = raw as Record<string, unknown>
  for (const key of ['colours', 'fonts', 'logo_rules', 'logo_files', 'hashtags', 'handles'] as const) {
    if (p[key] !== undefined && !Array.isArray(p[key])) return { ok: false, error: `${key} must be a list` }
    if (Array.isArray(p[key]) && (p[key] as unknown[]).length > MAX_ITEMS) {
      return { ok: false, error: `Too many entries in ${key} (max ${MAX_ITEMS})` }
    }
  }
  for (const c of (Array.isArray(p.colours) ? p.colours : []) as Record<string, unknown>[]) {
    if (!normaliseHex(c?.hex)) {
      return { ok: false, error: `"${text(c?.name, 40) || String(c?.hex ?? '')}" needs a colour code like #1A2B3C` }
    }
    if (c.role !== undefined && !COLOUR_ROLES.includes(String(c.role) as ColourRole)) {
      return { ok: false, error: `Colour role must be one of ${COLOUR_ROLES.join(', ')}` }
    }
  }
  for (const f of (Array.isArray(p.fonts) ? p.fonts : []) as Record<string, unknown>[]) {
    if (!text(f?.name)) return { ok: false, error: 'Every font needs a name' }
    if (f.role !== undefined && !FONT_ROLES.includes(String(f.role) as FontRole)) {
      return { ok: false, error: `Font role must be ${FONT_ROLES.join(' or ')}` }
    }
    const url = text(f.url, 500)
    if (url && !isUrl(url)) return { ok: false, error: `The link for ${text(f.name)} must start with https://` }
  }
  for (const f of (Array.isArray(p.logo_files) ? p.logo_files : []) as Record<string, unknown>[]) {
    if (!isUrl(text(f?.url, 1000))) return { ok: false, error: 'A logo file needs a link starting with https://' }
  }
  return { ok: true, profile: normaliseProfile(p) }
}

/** Is there anything in it worth showing? */
export function profileHasContent(p: BrandProfile | null | undefined): boolean {
  if (!p) return false
  return p.colours.length > 0 || p.fonts.length > 0 || p.logo_rules.length > 0 || p.logo_files.length > 0
    || p.voice.dos.length > 0 || p.voice.donts.length > 0 || Boolean(p.voice.summary || p.voice.tone)
    || p.hashtags.length > 0 || p.handles.length > 0 || Boolean(p.notes)
}

// ── scan → profile ──────────────────────────────────────────────────────────

const ROLE_RANK: Record<ColourRole, number> = { primary: 0, secondary: 1, accent: 2, background: 3, text: 4 }

/** Guess a colour's role from what the guidelines called it. */
export function guessColourRole(name?: string, usage?: string, index = 0): ColourRole {
  const h = `${usage ?? ''} ${name ?? ''}`.toLowerCase()
  if (/background|paper|ivory|cream|linen|off.?white|canvas|base/.test(h)) return 'background'
  if (/\btext\b|\btype\b|copy|body|ink|charcoal|black/.test(h)) return 'text'
  if (/accent|highlight|call.?to|cta|pop/.test(h)) return 'accent'
  if (/primary|main|brand|hero|signature/.test(h)) return 'primary'
  if (/secondary|support/.test(h)) return 'secondary'
  return index === 0 ? 'primary' : 'secondary'
}

export function guessFontRole(usage?: string, index = 0): FontRole {
  const h = (usage ?? '').toLowerCase()
  if (/head|display|title|hero|logo/.test(h)) return 'heading'
  if (/body|text|paragraph|copy|ui/.test(h)) return 'body'
  return index === 0 ? 'heading' : 'body'
}

/** What a scan result looks like as an editable profile. Colours are ordered
 *  by role (main first, text last); everything else keeps the document's order. */
export function fromScan(scan: ScanProfile | null | undefined, scannedAt: string | null = null): BrandProfile {
  const s = scan ?? {}
  const colours = (s.colors ?? [])
    .map((c, i) => ({ name: c.name ?? '', hex: c.hex ?? '', role: guessColourRole(c.name, c.usage, i) }))
    .filter(c => normaliseHex(c.hex))
  colours.sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role])
  const fonts = (s.fonts ?? []).map((f, i) => ({ name: f.family, role: guessFontRole(f.usage, i) }))
  const notes = [
    ...(s.imagery?.length ? ['Imagery', ...s.imagery.map(x => `• ${x}`)] : []),
    ...(s.other_rules?.length ? ['Other rules', ...s.other_rules.map(x => `• ${x}`)] : []),
  ].join('\n')
  return normaliseProfile({
    colours, fonts,
    logo_rules: s.logo_rules ?? [],
    voice: {
      summary: s.voice?.description ?? s.summary ?? '',
      tone: s.voice?.tone ?? s.voice?.keywords?.join(', ') ?? '',
      dos: s.dos_and_donts?.dos ?? [], donts: s.dos_and_donts?.donts ?? [],
    },
    notes,
    reviewed_scan_at: scannedAt,
  })
}

/** The profile in the scan's shape, for code that still reads that. */
export function toScanShape(p: BrandProfile): ScanProfile {
  const out: ScanProfile = {}
  if (p.voice.summary) out.summary = p.voice.summary
  if (p.colours.length) out.colors = p.colours.map(c => ({ name: c.name || undefined, hex: c.hex, usage: c.role }))
  if (p.fonts.length) out.fonts = p.fonts.map(f => ({ family: f.name, usage: f.role }))
  if (p.logo_rules.length) out.logo_rules = [...p.logo_rules]
  if (p.voice.tone || p.voice.summary) {
    out.voice = { ...(p.voice.tone ? { tone: p.voice.tone } : {}), ...(p.voice.summary ? { description: p.voice.summary } : {}) }
  }
  if (p.voice.dos.length || p.voice.donts.length) {
    out.dos_and_donts = { ...(p.voice.dos.length ? { dos: [...p.voice.dos] } : {}), ...(p.voice.donts.length ? { donts: [...p.voice.donts] } : {}) }
  }
  const other = [...p.hashtags, ...p.handles]
  if (p.notes) other.push(...p.notes.split('\n').map(l => l.replace(/^•\s*/, '').trim()).filter(Boolean))
  if (other.length) out.other_rules = other
  return out
}

// ── re-scan: propose, never overwrite ───────────────────────────────────────

export type ProposedSection = 'colours' | 'fonts' | 'logo_rules' | 'dos' | 'donts' | 'voice_summary' | 'voice_tone' | 'notes'

export type ProposedChange = {
  id: string
  section: ProposedSection
  /** what the person sees in the review list */
  label: string
  value: BrandColour | BrandFont | string
}

export type Proposal = { scan_at: string | null; changes: ProposedChange[] }

/**
 * Everything a newer scan knows that the profile does not. Only additions —
 * and the voice paragraphs only when the profile's are still empty — so a
 * hand edit can never be silently undone by a document.
 */
export function proposeFromScan(current: BrandProfile, scan: ScanProfile | null | undefined, scannedAt: string | null): Proposal {
  const incoming = fromScan(scan, scannedAt)
  const changes: ProposedChange[] = []
  const lower = (s: string) => s.toLowerCase()

  const haveHex = new Set(current.colours.map(c => c.hex))
  for (const c of incoming.colours) if (!haveHex.has(c.hex)) {
    changes.push({ id: `colour:${c.hex}`, section: 'colours', label: `${c.name || c.hex} (${c.hex})`, value: c })
  }
  const haveFont = new Set(current.fonts.map(f => lower(f.name)))
  for (const f of incoming.fonts) if (!haveFont.has(lower(f.name))) {
    changes.push({ id: `font:${lower(f.name)}`, section: 'fonts', label: f.name, value: f })
  }
  const lists: [ProposedSection, string[], string[]][] = [
    ['logo_rules', current.logo_rules, incoming.logo_rules],
    ['dos', current.voice.dos, incoming.voice.dos],
    ['donts', current.voice.donts, incoming.voice.donts],
  ]
  for (const [section, have, next] of lists) {
    const set = new Set(have.map(lower))
    for (const s of next) if (!set.has(lower(s))) changes.push({ id: `${section}:${lower(s)}`, section, label: s, value: s })
  }
  if (!current.voice.summary && incoming.voice.summary) {
    changes.push({ id: 'voice_summary', section: 'voice_summary', label: incoming.voice.summary, value: incoming.voice.summary })
  }
  if (!current.voice.tone && incoming.voice.tone) {
    changes.push({ id: 'voice_tone', section: 'voice_tone', label: incoming.voice.tone, value: incoming.voice.tone })
  }
  if (incoming.notes) {
    const haveLines = new Set(current.notes.split('\n').map(l => lower(l.trim())))
    const fresh = incoming.notes.split('\n').filter(l => l.startsWith('•') && !haveLines.has(lower(l.trim())))
    if (fresh.length) changes.push({ id: 'notes', section: 'notes', label: fresh.map(l => l.replace(/^•\s*/, '')).join(' · '), value: fresh.join('\n') })
  }
  return { scan_at: scannedAt, changes }
}

/** Fold the accepted changes in and mark the scan reviewed (declined ones
 *  are not asked about again until the next scan). */
export function applyProposal(current: BrandProfile, proposal: Proposal, acceptIds: Iterable<string>): BrandProfile {
  const accept = new Set(acceptIds)
  const next: BrandProfile = {
    ...current,
    colours: [...current.colours], fonts: [...current.fonts], logo_rules: [...current.logo_rules],
    voice: { ...current.voice, dos: [...current.voice.dos], donts: [...current.voice.donts] },
    reviewed_scan_at: proposal.scan_at ?? current.reviewed_scan_at,
  }
  for (const ch of proposal.changes) {
    if (!accept.has(ch.id)) continue
    switch (ch.section) {
      case 'colours': next.colours.push(ch.value as BrandColour); break
      case 'fonts': next.fonts.push(ch.value as BrandFont); break
      case 'logo_rules': next.logo_rules.push(ch.value as string); break
      case 'dos': next.voice.dos.push(ch.value as string); break
      case 'donts': next.voice.donts.push(ch.value as string); break
      case 'voice_summary': next.voice.summary = ch.value as string; break
      case 'voice_tone': next.voice.tone = ch.value as string; break
      case 'notes': next.notes = [next.notes, ch.value as string].filter(Boolean).join('\n'); break
    }
  }
  return normaliseProfile(next)
}

/** Has this scan been looked at? A scan newer than the last review is waiting. */
export function scanIsUnreviewed(profile: BrandProfile, scannedAt: string | null | undefined): boolean {
  if (!scannedAt) return false
  if (!profile.reviewed_scan_at) return true
  return new Date(scannedAt).getTime() > new Date(profile.reviewed_scan_at).getTime()
}

/** Move one entry in a list; out-of-range is a no-op. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const out = [...list]
  const [it] = out.splice(from, 1)
  out.splice(to, 0, it)
  return out
}
