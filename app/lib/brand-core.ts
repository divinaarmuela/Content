/**
 * Pure brand-scan core — no imports, no I/O, fully unit-testable.
 * Owns how a large guidelines document is divided for the model, and how two
 * extracted profiles merge. The server layer (brand-extract.ts) does the PDF
 * surgery and the model calls.
 */

/**
 * The model accepts 32MB and 100 pages per request, and a design document is
 * mostly full-page imagery — so a real brand book blows the size limit long
 * before the page limit. We stay well under both: dense pages cost roughly
 * 1.5–3k tokens each, so 20 pages a chunk keeps every request comfortable.
 */
export const MAX_PAGES_PER_CHUNK = 20

/** Page ranges to send, as [startPage, endPageExclusive] pairs, 0-indexed. */
export function planChunks(pageCount: number, perChunk = MAX_PAGES_PER_CHUNK): [number, number][] {
  if (pageCount <= 0) return []
  const size = Math.max(1, perChunk)
  const out: [number, number][] = []
  for (let start = 0; start < pageCount; start += size) {
    out.push([start, Math.min(start + size, pageCount)])
  }
  return out
}

export type BrandProfile = {
  summary?: string
  fonts?: { family: string; usage?: string; weights?: string[] }[]
  colors?: { name?: string; hex?: string; usage?: string }[]
  logo_rules?: string[]
  voice?: { tone?: string; description?: string; keywords?: string[] }
  imagery?: string[]
  dos_and_donts?: { dos?: string[]; donts?: string[] }
  other_rules?: string[]
}

/**
 * Force a list item to a string.
 *
 * A tool schema constrains shape, not judgement: asked for "imagery" as
 * strings, the model returned {type, description} objects for one client, and
 * a rule rendered straight into React as an object crashes the whole panel.
 * So every list is flattened here, at the boundary, rather than trusted.
 */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    // the common shapes: {type, description} / {title, detail} / {rule}
    const label = asText(o.type ?? o.title ?? o.name ?? o.label)
    const body = asText(o.description ?? o.detail ?? o.text ?? o.rule ?? o.value)
    if (label && body) return `${label}: ${body}`
    if (label || body) return label || body
    return Object.values(o).map(asText).filter(Boolean).join(' — ')
  }
  return ''
}

const dedupe = (list: unknown[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const s = asText(raw)
    const key = s.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/** Everything the panel renders as text, forced to text. Applied to whatever
 *  the model returns, so a bad shape is a tidy string rather than a crash. */
export function sanitiseProfile(raw: BrandProfile | null): BrandProfile {
  if (!raw) return {}
  const p = raw as Record<string, unknown>
  const out: BrandProfile = {}

  const summary = asText(p.summary)
  if (summary) out.summary = summary

  const fonts = (Array.isArray(p.fonts) ? p.fonts : [])
    .map(f => {
      const o = (f ?? {}) as Record<string, unknown>
      const family = asText(o.family)
      if (!family) return null
      const font: NonNullable<BrandProfile['fonts']>[number] = { family }
      const usage = asText(o.usage)
      if (usage) font.usage = usage
      const weights = dedupe(Array.isArray(o.weights) ? o.weights : [])
      if (weights.length > 0) font.weights = weights
      return font
    })
    .filter(Boolean) as NonNullable<BrandProfile['fonts']>
  if (fonts.length > 0) out.fonts = fonts

  const colors = (Array.isArray(p.colors) ? p.colors : [])
    .map(c => {
      const o = (c ?? {}) as Record<string, unknown>
      const color: NonNullable<BrandProfile['colors']>[number] = {}
      const name = asText(o.name); if (name) color.name = name
      const hex = asText(o.hex); if (hex) color.hex = hex
      const usage = asText(o.usage); if (usage) color.usage = usage
      return Object.keys(color).length > 0 ? color : null
    })
    .filter(Boolean) as NonNullable<BrandProfile['colors']>
  if (colors.length > 0) out.colors = colors

  for (const key of ['logo_rules', 'imagery', 'other_rules'] as const) {
    const list = dedupe(Array.isArray(p[key]) ? (p[key] as unknown[]) : [])
    if (list.length > 0) out[key] = list
  }

  const voiceRaw = (p.voice ?? {}) as Record<string, unknown>
  const voice: NonNullable<BrandProfile['voice']> = {}
  const tone = asText(voiceRaw.tone); if (tone) voice.tone = tone
  const description = asText(voiceRaw.description); if (description) voice.description = description
  const keywords = dedupe(Array.isArray(voiceRaw.keywords) ? voiceRaw.keywords : [])
  if (keywords.length > 0) voice.keywords = keywords
  if (Object.keys(voice).length > 0) out.voice = voice

  const dd = (p.dos_and_donts ?? {}) as Record<string, unknown>
  const dos = dedupe(Array.isArray(dd.dos) ? dd.dos : [])
  const donts = dedupe(Array.isArray(dd.donts) ? dd.donts : [])
  if (dos.length > 0 || donts.length > 0) {
    out.dos_and_donts = { ...(dos.length ? { dos } : {}), ...(donts.length ? { donts } : {}) }
  }

  return out
}

/**
 * Merge a newly extracted profile into what we already know.
 *
 * The model merges semantically when it can see the previous profile, but a
 * chunked scan sends many requests and the same rule reappears in several —
 * so identity is enforced here too: a font by family, a colour by hex (else
 * name), a rule by its text. Later chunks fill gaps rather than overwrite,
 * because the first mention of a fact is usually the definitive one.
 */
export function mergeProfiles(
  previousRaw: BrandProfile | null, nextRaw: BrandProfile,
): BrandProfile {
  // both sides sanitised first: a merge is also the moment a bad shape would
  // be written to the database and rendered later
  const previous = sanitiseProfile(previousRaw)
  const next = sanitiseProfile(nextRaw)
  if (Object.keys(previous).length === 0) return next
  const out: BrandProfile = { ...previous }

  if (next.summary && !out.summary) out.summary = next.summary

  const fonts = [...(previous.fonts ?? [])]
  for (const f of next.fonts ?? []) {
    const key = f.family?.trim().toLowerCase()
    if (!key) continue
    const hit = fonts.find(x => x.family?.trim().toLowerCase() === key)
    if (!hit) fonts.push(f)
    else {
      if (!hit.usage && f.usage) hit.usage = f.usage
      if ((hit.weights?.length ?? 0) === 0 && f.weights?.length) hit.weights = f.weights
    }
  }
  if (fonts.length > 0) out.fonts = fonts

  const colors = [...(previous.colors ?? [])]
  for (const c of next.colors ?? []) {
    const key = (c.hex ?? c.name ?? '').trim().toLowerCase()
    if (!key) continue
    const hit = colors.find(x => (x.hex ?? x.name ?? '').trim().toLowerCase() === key)
    if (!hit) colors.push(c)
    else {
      if (!hit.name && c.name) hit.name = c.name
      if (!hit.usage && c.usage) hit.usage = c.usage
      if (!hit.hex && c.hex) hit.hex = c.hex
    }
  }
  if (colors.length > 0) out.colors = colors

  for (const key of ['logo_rules', 'imagery', 'other_rules'] as const) {
    const merged = dedupe([...(previous[key] ?? []), ...(next[key] ?? [])])
    if (merged.length > 0) out[key] = merged
  }

  if (next.voice || previous.voice) {
    out.voice = {
      tone: previous.voice?.tone || next.voice?.tone,
      description: previous.voice?.description || next.voice?.description,
      keywords: dedupe([...(previous.voice?.keywords ?? []), ...(next.voice?.keywords ?? [])]),
    }
    if (!out.voice.tone) delete out.voice.tone
    if (!out.voice.description) delete out.voice.description
    if (out.voice.keywords?.length === 0) delete out.voice.keywords
  }

  const dos = dedupe([...(previous.dos_and_donts?.dos ?? []), ...(next.dos_and_donts?.dos ?? [])])
  const donts = dedupe([...(previous.dos_and_donts?.donts ?? []), ...(next.dos_and_donts?.donts ?? [])])
  if (dos.length > 0 || donts.length > 0) {
    out.dos_and_donts = { ...(dos.length ? { dos } : {}), ...(donts.length ? { donts } : {}) }
  }

  return out
}

/** Is there anything in this profile worth showing? */
export function profileIsEmpty(p: BrandProfile | null): boolean {
  if (!p) return true
  return Object.values(p).every(v =>
    v == null || (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && Object.keys(v).length === 0) ||
    (typeof v === 'string' && v.trim() === ''))
}
