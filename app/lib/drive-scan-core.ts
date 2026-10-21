/**
 * THE EDITOR PREVIEW'S DRIVE INBOX — the pure half (the owner, 21 Oct 2026: "we need ai everytime a file is modified
 * and crosschecks with the current submitted files … this means we can submit any links etc and do version tracking").
 *
 * WHY: a hand-in used to take "the whole link" as the version, and one master link holds Version 1's drafts, the
 * quality check's re-cut, the colourist's graded files and Version 2 side by side — so every later hand-in pulled the
 * old ones back in (the dry run of 21 Oct 2026: "September 18th" would have taken 14 files its editor left out).
 *
 * THE MODEL: Drive is the inbox; the app keeps the versions.
 *   - a SOURCE is one link a card was given — a master link, the colourist's own, a new one for Version 2;
 *   - a SEEN file is one Drive file at one content (its id and checksum), met once — a re-export over the same file
 *     is seen again, an old file never is;
 *   - the card's stage decides who it is offered to, or that it waits (the owner: "once its in quality check new
 *     videos added should be ignored");
 *   - the AI says which video it is and what it is (draft, re-cut, graded, copy); a person confirms; the version
 *     number is the card's (edit-round-core), never a file's or a folder's name.
 *
 * Drive is only read (CLAUDE.md trap 13). Pure: no I/O.
 */

export type SeenState = 'new' | 'scanning' | 'scanned' | 'taken' | 'ignored' | 'locked' | 'copy' | 'footage' | 'failed'
export type CutKind = 'draft' | 'recut' | 'graded' | 'copy' | 'footage' | 'new_video'

/** what one listing says of one file — DriveTargetFile's shape, re-said here so this file stays pure */
export type SeenFile = {
  id: string
  /** "Sub/Folder/Name.mp4" — the path inside the link */
  name: string
  mime: string
  size?: number | null
  modified?: string | null
  md5?: string | null
  revision?: string | null
  created?: string | null
  lastModifier?: string | null
  durationMs?: number | null
  width?: number | null
  height?: number | null
}

export const sourceId = (itemId: string, driveId: string) => `${itemId}~${driveId}`

/** WHICH CONTENT: the checksum, else the head revision, else size and change time — a re-export changes it */
export function contentKey(f: Pick<SeenFile, 'md5' | 'revision' | 'size' | 'modified'>): string {
  if (f.md5) return `m${f.md5}`
  if (f.revision) return `r${f.revision}`
  return `s${f.size ?? 'x'}@${(f.modified ?? 'x').replace(/[^0-9]/g, '')}`
}
export const seenId = (itemId: string, f: SeenFile) => `${itemId}~${f.id}~${contentKey(f)}`.replace(/[.#$[\]/]/g, '_')

/* ─── the stage decides ─────────────────────────────────────────────────── */

export type StageRule = { who: 'editor' | 'colourist' | 'nobody'; why: string | null }

const EDITOR_STAGES = ['draft_uploaded', 'revision_required', 'revision_complete', 'client_changes_requested']

/** who a new file is for at this stage — or why it waits */
export function stageRule(status: unknown): StageRule {
  const s = String(status ?? '')
  if (EDITOR_STAGES.includes(s)) return { who: 'editor', why: null }
  if (s === 'colour_grade') return { who: 'colourist', why: null }
  if (s === 'quality_check' || s === 'internal_review') return { who: 'nobody', why: 'Added after this went to the quality check — it isn’t included, and is offered at the next hand-in.' }
  if (s === 'client_review') return { who: 'nobody', why: 'Added while the client is reviewing — their set doesn’t change; it’s offered if they ask for changes.' }
  return { who: 'nobody', why: 'Added after this was approved — approved files don’t change.' }
}

/** the stages the inbox watches: from the first draft until it is approved */
export const WATCHED_STATUSES: readonly string[] = [
  'draft_uploaded', 'revision_required', 'revision_complete', 'quality_check', 'internal_review', 'colour_grade',
  'client_review', 'client_changes_requested', 'approved_for_scheduling',
]

/* ─── what a file is, without looking at it ─────────────────────────────── */

const FOOTAGE_FOLDER = /^(raw|raws|footage|rushes|camera|cam ?[a-z0-9]?|b-?roll|selects|source|sources|audio|music|sfx|project|projects|assets|mxf)$/i
const CAMERA_NAME = /^(img|mvi|dji|dsc|pxl|gopr|gx\d*|vid)_?\d+|^c\d{4}\b|^a\d{3}c\d{3}/i

export function isVideo(f: Pick<SeenFile, 'mime' | 'name'>): boolean {
  return /^video\//.test(f.mime) || /\.(mp4|mov|m4v|mxf|avi|webm|mkv)$/i.test(f.name)
}
export function isMedia(f: Pick<SeenFile, 'mime' | 'name'>): boolean {
  return isVideo(f) || /^image\//.test(f.mime) || f.mime === 'application/pdf' || /\.(jpe?g|png|webp|heic|pdf)$/i.test(f.name)
}
export const folderOf = (path: string) => { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i) }
export const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** shoot footage, not finished work: in a Raw/Footage/… folder, or named the way a camera names a clip */
export function isFootage(f: Pick<SeenFile, 'name'>): boolean {
  if (folderOf(f.name).split('/').some(p => FOOTAGE_FOLDER.test(p.trim()))) return true
  if (/\.(mxf|braw|r3d|ari|crm)$/i.test(f.name)) return true   // camera originals, never a cut
  return CAMERA_NAME.test(baseOf(f.name))
}

/**
 * THE LINKS A CARD IS WATCHED THROUGH — every Drive link the card has: its hand-ins, its own link, its raw-footage link
 * and the links of its earlier versions (the owner, 21 Oct 2026: editors keep adding cuts to the card's links — OCT
 * Spring Shoot's raw link holds New Menu Medley Draft, v2, V3 and final). Camera files in them are skipped as footage.
 */
export function cardLinksOf(item: { link_url?: unknown; raw_assets_url?: unknown; link_versions?: unknown }, handIns: readonly { link: string; by?: string | null }[]): { link: string; by: string | null }[] {
  const isDrive = (v: unknown): v is string => typeof v === 'string' && /drive\.google\.com/.test(v)
  const out: { link: string; by: string | null }[] = handIns.map(h => ({ link: h.link, by: h.by ?? null }))
  for (const v of [item.link_url, item.raw_assets_url]) if (isDrive(v)) out.push({ link: v.trim(), by: null })
  for (const v of Array.isArray(item.link_versions) ? item.link_versions as { url?: unknown }[] : []) if (isDrive(v?.url)) out.push({ link: v.url.trim(), by: null })
  return out.filter((l, k) => l.link && out.findIndex(o => o.link === l.link) === k)
}

/** a folder that says "graded" — a hint only, never the decision */
export const GRADED_FOLDER = /(^|\/)(graded?|cc|colou?r(ed)?|colou?r ?grade[ds]?|grade[ds]?|final[s]?)(\/|$)/i

/**
 * THE NAME WITHOUT ITS VERSION WORDS — "Pasta v2.mp4", "Pasta_V03", "Pasta FINAL", "Pasta (1)", "Pasta copy",
 * "Pasta graded", "Pasta 21-10" are all "pasta". The numbers that NAME a video stay: "Pod 2" is not "Pod".
 */
export function nameStem(path: string): string {
  let s = baseOf(path).replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase()
  s = s.replace(/\(\d+\)/g, ' ')
  s = s.replace(/\b\d{4}[-_.]\d{1,2}[-_.]\d{1,2}\b|\b\d{1,2}[-_.]\d{1,2}([-_.]\d{2,4})?\b/g, ' ')
  s = s.replace(/[_\-.]+/g, ' ')
  s = s.replace(/\b(v|ver|version|rev|r)\s?\d{1,3}\b/g, ' ')
  s = s.replace(/\b(final|finals|graded|grade|cc|colou?r(ed)?|draft|copy|export|exported|new|latest|edit|fixed|updated|hq|lq)\b/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/* ─── new since last time ───────────────────────────────────────────────── */

/** what the card already holds, by Drive file: its checksums — a copy of one of these is not new work */
export type CardFile = { id: string; asset: string; name: string; drive_file_id?: string | null; drive_md5?: string | null; version: number; duration_ms?: number | null }

/**
 * THE STATE A NEWLY SEEN FILE STARTS IN. Already on the card (same Drive file, same content) → taken; the same bytes
 * as a file on the card (another link, a copy) → copy; shoot footage or not a picture/clip/PDF → footage; the stage
 * says nobody may add now → locked; else new, for the AI.
 */
export function firstState(f: SeenFile, cardFiles: readonly CardFile[], status: unknown): SeenState {
  const onCard = cardFiles.find(c => c.drive_file_id === f.id)
  if (onCard && (!f.md5 || !onCard.drive_md5 || onCard.drive_md5 === f.md5)) return 'taken'
  if (f.md5 && cardFiles.some(c => c.drive_md5 === f.md5)) return 'copy'
  if (!isMedia(f) || isFootage(f)) return 'footage'
  if (stageRule(status).who === 'nobody') return 'locked'
  return 'new'
}

/** the listing's files not yet seen at this content */
export function unseen<T extends SeenFile>(itemId: string, listing: readonly T[], seenIds: ReadonlySet<string>): T[] {
  return listing.filter(f => !seenIds.has(seenId(itemId, f)))
}

/* ─── which video it may be, before any AI ──────────────────────────────── */

export type Candidate = { asset: string; name: string; score: number; why: string[] }

/**
 * THE VIDEOS THIS FILE MAY BE A CUT OF, best first — by the name without its version words, the folder, and the
 * length (a grade keeps the length to the frame; a re-cut usually doesn't). The AI is shown the top three.
 */
export function rankCandidates(f: SeenFile, current: readonly CardFile[], max = 3): Candidate[] {
  const stem = nameStem(f.name)
  const folder = folderOf(f.name).toLowerCase()
  const out: Candidate[] = []
  for (const c of current) {
    const why: string[] = []
    let score = 0
    const cs = nameStem(c.name)
    if (stem && cs === stem) { score += 5; why.push('same name') }
    else if (stem && cs && (stem.includes(cs) || cs.includes(stem))) { score += 2; why.push('similar name') }
    if (folder && folderOf(c.name).toLowerCase() === folder) { score += 1; why.push('same folder') }
    if (f.durationMs && c.duration_ms) {
      const d = Math.abs(f.durationMs - c.duration_ms)
      if (d <= 100) { score += 3; why.push('same length') }
      else if (d <= 2000) { score += 1; why.push('nearly the same length') }
    }
    if (score > 0) out.push({ asset: c.asset, name: c.name, score, why })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max)
}

/* ─── the verdict ───────────────────────────────────────────────────────── */

/** what the AI said, as its tool returns it */
export type AiAnswer = {
  match: string            // an asset id from the candidates, or 'new'
  same_edit: boolean
  colour_changed: boolean
  confidence: number       // 0–1
  reasons: string[]
}

export type Verdict = {
  kind: CutKind
  asset: string | null      // the video it is a cut of; null = a new video
  confidence: number
  reasons: string[]
  /** the context and the AI disagree, or the AI is unsure — the person is asked, nothing is pre-filled */
  ask: boolean
}

export const SURE = 0.75

/**
 * GRADED = THE SAME EDIT WITH ITS COLOUR CHANGED (the owner, 21 Oct 2026: "my only question is how u would know its
 * graded"). Same edit, colour the same → a copy or plain re-export; same video, a different edit → a re-cut; no match
 * → a new video. The stage and who added it support the verdict — they never make it: a "graded" look added by the
 * editor while editing is asked about, not filed.
 */
export function verdictOf(ai: AiAnswer, ctx: { status: unknown; candidates: readonly Candidate[]; byColourist: boolean; gradedFolder: boolean }): Verdict {
  const known = ai.match !== 'new' && ctx.candidates.some(c => c.asset === ai.match)
  const reasons = [...ai.reasons]
  if (!known) return { kind: 'new_video', asset: null, confidence: ai.confidence, reasons, ask: ai.confidence < SURE }
  let kind: CutKind = ai.same_edit ? (ai.colour_changed ? 'graded' : 'copy') : 'recut'
  let ask = ai.confidence < SURE
  const atGrade = String(ctx.status ?? '') === 'colour_grade'
  if (kind === 'graded' && !atGrade && !ctx.byColourist) { ask = true; reasons.push('Looks graded, but it was added outside colour grade — check it') }
  if (kind !== 'graded' && atGrade && (ctx.byColourist || ctx.gradedFolder)) { ask = true; reasons.push('Added at colour grade, but the colour looks unchanged — was it graded?') }
  if (kind === 'recut' && atGrade) { ask = true; reasons.push('A different edit arrived at colour grade — the quality check passed the other one') }
  return { kind, asset: ai.match, confidence: ai.confidence, reasons, ask }
}

/* ─── words ─────────────────────────────────────────────────────────────── */

export const KIND_WORDS: Record<CutKind, string> = {
  draft: 'Draft', recut: 'Re-cut', graded: 'Graded', copy: 'Copy — not new work', footage: 'Shoot footage', new_video: 'New video',
}
export const STATE_WORDS: Record<SeenState, string> = {
  new: 'Waiting for the AI', scanning: 'AI scanning…', scanned: 'Ready to confirm', taken: 'On the card', ignored: 'Ignored',
  locked: 'Waiting — the card has moved on', copy: 'Same as a file on the card', footage: 'Skipped — footage or not a video', failed: 'Couldn’t scan',
}
/** the states still asking something of a person */
export const OPEN_STATES: readonly SeenState[] = ['new', 'scanning', 'scanned', 'locked', 'failed']

/* ─── the scan, step by step — what the page shows while it runs ────────── */

export const SCAN_STEPS = [
  { key: 'measure', label: 'Measuring', words: 'Reading the video from Drive' },
  { key: 'sound', label: 'Sound', words: 'Comparing the sound at four moments' },
  { key: 'frames', label: 'Frames', words: 'Comparing the shots at the same moments' },
  { key: 'colour', label: 'Colour', words: 'Checking contrast and saturation for a grade' },
  { key: 'ai', label: 'AI check', words: 'The AI looks at it all and decides' },
] as const
export type ScanStepKey = (typeof SCAN_STEPS)[number]['key']
export type StepState = 'waiting' | 'running' | 'done' | 'skipped' | 'failed'

/** the signals of one comparison, as scan-measure-core gives them */
export type Signals = { lengthGapMs: number | null; sound: number | null; colourShift: number | null; punchier: boolean | null }

/**
 * THE VERDICT FROM THE MEASURES ALONE — what the AI is checked against, and the answer when it can't be asked.
 * Same sound at the same moments and the same length = the same edit; with its colour moved = graded, unmoved = a
 * copy; similar sound = a re-cut of that video; else a new video.
 */
export function signalAnswer(best: { asset: string; s: Signals } | null): AiAnswer {
  if (!best) return { match: 'new', same_edit: false, colour_changed: false, confidence: 0.6, reasons: ['No video on the card sounds like it'] }
  const { s } = best
  const sameLength = s.lengthGapMs !== null && s.lengthGapMs <= 150
  const sameSound = s.sound !== null && s.sound >= 0.8
  const moved = s.colourShift !== null && s.colourShift >= 6
  if (sameSound && sameLength) return { match: best.asset, same_edit: true, colour_changed: moved, confidence: 0.85, reasons: [] }
  if ((s.sound ?? 0) >= 0.5 || sameLength) return { match: best.asset, same_edit: false, colour_changed: moved, confidence: 0.65, reasons: [] }
  return { match: 'new', same_edit: false, colour_changed: false, confidence: 0.6, reasons: [] }
}

/**
 * THE AI HELD TO THE MEASURES. A match the measures flatly contradict — no shared sound and a very different length —
 * stands only when the AI is sure; otherwise it is a new video, asked. Live, 21 Oct 2026: Haiku called two unrelated
 * videos "re-cuts" while its own reasons said "different subject matter".
 */
export function heldToMeasures(ai: AiAnswer, s: Signals | null): AiAnswer {
  if (ai.match === 'new' || !s || ai.confidence >= 0.85) return ai
  const noSound = s.sound !== null && s.sound < 0.3
  const farLength = s.lengthGapMs !== null && s.lengthGapMs > 20_000
  if (!(noSound && farLength)) return ai
  return { match: 'new', same_edit: false, colour_changed: false, confidence: Math.min(ai.confidence, 0.6), reasons: ['The sound and the length match none of the card’s videos', ...ai.reasons] }
}

/** how close a card video is on the measures — the AI is shown the best two */
export function signalScore(s: Signals): number {
  return (s.sound ?? 0) * 3 + (s.lengthGapMs === null ? 0 : s.lengthGapMs <= 150 ? 2 : s.lengthGapMs <= 3000 ? 0.5 : 0)
}
