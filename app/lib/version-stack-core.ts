/**
 * THE VERSION STACKS — every file the AI has looked at on a card, put together into videos: one stack per video, its
 * versions in order with V1, V2, V3 on them, the latest on top (the owner, 21 Oct 2026: "it could have add a tag
 * which one is version 2 3 etc … the ui should immediately show the latest version stacked view … currently i have
 * to read one by one").
 *
 * Pure: the card's videos and the scanned Drive files in, the stacks out.
 *   - which files are one video: the AI's match (a file matched to a video is that video);
 *   - which files are one VERSION: a copy is the same version saved again, a grade is that version graded;
 *     a re-cut is the next version;
 *   - the order: when each first appeared (Drive's created time, else when it was found).
 * Never the file name.
 */

export type StackFile = {
  key: string                     // 'a:<asset>' a video on the card · 's:<drive_seen id>' a file in Drive
  name: string
  at: string                      // when it first appeared
  source: 'card' | 'drive' | 'other'   // other: the video on another card it was matched to — the earlier version
  kind: string | null             // the AI's verdict for a Drive file: copy | graded | recut | new_video …
  matchKey: string | null         // what the AI matched it to, as a key ('a:…', 's:…', 'o:<item>:<asset>')
  ask: boolean
  busy: boolean                   // still being scanned
  thumb: string | null
  /** the twelve frames the scan kept, evenly through the video — hover them for an instant look */
  frames?: { url: string; at_s: number }[]
  /** one small frame a second, tiled (scan-measure.makeStoryboard) — the timeline's pictures */
  board?: { url: string; cols: number; rows: number; count: number; every_s: number } | null
  /** a version on the card: its own file, to play and compare */
  file?: { id: string; url: string; name: string; version: number } | null
  confidence: number | null
  otherCard: string | null        // the title of another card it belongs to
  sameAs?: string | null          // a key of a file it is byte for byte (the same version, saved again)
}

export type StackEntry = StackFile & { label: string; graded: boolean; sameAsEarlier: boolean }
export type Stack = {
  key: string
  title: string
  entries: StackEntry[]           // oldest first
  latest: StackEntry
  versions: string[]              // ['V1', 'V2', …]
  ask: boolean
  busy: boolean
  otherCard: string | null
}

class Sets {
  private up = new Map<string, string>()
  find(x: string): string { const p = this.up.get(x) ?? x; if (p === x) return x; const r = this.find(p); this.up.set(x, r); return r }
  join(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.up.set(rb, ra) }
}

/** where a name puts a cut, for files of one day only: raw/draft first, then v1, v2…, then final */
export function nameRank(path: string): number {
  const n = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (/\bfinal\b|_final|\bvf\b|_vf\b/.test(n)) return 900
  const v = /(?:\bv|_v|version ?)(\d{1,2})(?!\d)/.exec(n)
  if (v) return 100 + Number(v[1])
  if (/draft|rough|\bwip\b/.test(n)) return 50
  return 100
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[a-z0-9]{2,4}$/i, '').trim()

export function stackVersions(files: readonly StackFile[]): Stack[] {
  const video = new Sets()   // files of one video
  const edit = new Sets()    // files of one version (copies and grades of the same edit)
  for (const f of files) {
    video.find(f.key); edit.find(f.key)
    if (f.sameAs) { video.join(f.sameAs, f.key); edit.join(f.sameAs, f.key) }
    if (!f.matchKey) continue
    video.join(f.matchKey, f.key)
    if (f.kind === 'copy' || f.kind === 'graded') edit.join(f.matchKey, f.key)
  }
  const byVideo = new Map<string, StackFile[]>()
  for (const f of files) { const r = video.find(f.key); byVideo.set(r, [...(byVideo.get(r) ?? []), f]) }

  const stacks: Stack[] = []
  for (const [key, group] of byVideo) {
    // by when each appeared; on the same day, by what its name says (draft before v2 before final) — a tie-break only
    const sorted = [...group].sort((a, b) => a.at.slice(0, 10).localeCompare(b.at.slice(0, 10)) || nameRank(a.name) - nameRank(b.name) || a.at.localeCompare(b.at) || (a.source === b.source ? 0 : a.source === 'card' ? -1 : 1))
    // a version is numbered when its first file appeared
    const labelOf = new Map<string, string>()
    let n = 0
    for (const f of sorted) { const e = edit.find(f.key); if (!labelOf.has(e)) labelOf.set(e, `V${++n}`) }
    const firstOfEdit = new Set<string>()
    const entries: StackEntry[] = sorted.map(f => {
      const e = edit.find(f.key)
      const graded = f.kind === 'graded'
      const sameAsEarlier = !graded && firstOfEdit.has(e)
      firstOfEdit.add(e)
      return { ...f, label: labelOf.get(e)!, graded, sameAsEarlier }
    })
    // the latest: the newest version, its graded file first, else its newest file
    const top = `V${n}`
    const ofTop = entries.filter(x => x.label === top)
    const latest = ofTop.find(x => x.graded) ?? ofTop[ofTop.length - 1]
    stacks.push({
      key,
      title: baseName(latest.name),
      entries,
      latest,
      versions: [...new Set(entries.map(x => x.label))],
      ask: entries.some(x => x.ask),
      busy: entries.some(x => x.busy),
      otherCard: entries.find(x => x.otherCard)?.otherCard ?? null,
    })
  }
  // what needs a look first, then the newest
  return stacks.sort((a, b) => Number(b.ask || b.busy) - Number(a.ask || a.busy) || b.latest.at.localeCompare(a.latest.at))
}
