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

const dedupe = (list: string[]): string[] => {
  const seen = new Set<string>()
  return list.filter(s => {
    const key = s.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
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
export function mergeProfiles(previous: BrandProfile | null, next: BrandProfile): BrandProfile {
  if (!previous || Object.keys(previous).length === 0) return next
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
