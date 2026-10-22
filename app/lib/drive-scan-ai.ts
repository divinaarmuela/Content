import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { table } from '@/lib/db'
import type { ContentItem, DriveSeen, DriveSource, TeamUser, WorkKind } from '@/lib/db-types'
import { isEditorCard, laneOf } from './editor-preview-core'
import { assetIdOf, currentFiles, isRetiredAt } from './final-files-core'
import { roundOf } from './edit-round-core'
import {
  GRADED_FOLDER, KIND_WORDS, heldToMeasures, isFootage, isVideo, namedReasons, rankCandidates, signalAnswer, signalScore, verdictOf,
  type AiAnswer, type ScanStepKey, type Signals, type StepState,
} from './drive-scan-core'
import { compareProbes, comparisonWords } from './scan-measure-core'
import { drivePublicUrl, probeVideo, type Probe } from './scan-measure'
import { cardFilesOf } from './drive-scan'
import { storedCopyOf } from './drive-pull'

/**
 * THE AI SCAN OF ONE NEW FILE (the owner, 21 Oct 2026: "we need ai everytime a file is modified and crosschecks with
 * the current submitted files … my only question is how u would know its graded").
 *
 *   1 measure — the new video's length, twelve frames, their colour, and its sound at those moments (scan-measure.ts);
 *   2 sound   — against every video on the card (measured once, cached): the same sound at the same moments is the
 *               same edit; the name of the file is never evidence;
 *   3 frames  — the best two are shown to the AI frame for frame;
 *   4 colour  — contrast and saturation moved with the shots unchanged is a grade;
 *   5 AI      — Claude looks at the frames and the measures and says which video and what it is, with reasons.
 *
 * Each step is written to the row as it runs, so the card page shows it happening. The verdict only SUGGESTS: a person
 * confirms (drive-scan-core.verdictOf asks whenever the AI and the context disagree). Nothing here touches a card.
 */

const MODEL = process.env.DRIVE_SCAN_MODEL || 'claude-sonnet-5'   // Haiku misjudged unrelated videos as re-cuts (live, 21 Oct 2026); a few calls a day
const MAX_CARD_VIDEOS = 12
const MAX_OTHER_VIDEOS = 40   // the client's other Editor cards: all their current videos (each measured once, then cached)

async function setSteps(id: string, patch: Partial<Record<ScanStepKey, StepState>>, extra: Record<string, unknown> = {}) {
  await table<DriveSeen>('drive_seen').claim(id, cur => {
    if (!cur) return null
    const scan = (cur.scan ?? {}) as { steps?: Record<string, StepState> }
    return { ...cur, scan: { ...scan, ...extra, steps: { ...(scan.steps ?? {}), ...patch } }, updated_at: new Date().toISOString() } as DriveSeen
  }).catch(() => undefined)
}

async function frameBlock(url: string | null): Promise<{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } } | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(await res.arrayBuffer()).toString('base64') } }
  } catch { return null }
}

const VERDICT_TOOL = {
  name: 'verdict',
  description: 'Say which of the card\'s videos the new file is a cut of (or "new"), whether it is the same edit, and whether its colour was changed (graded).',
  input_schema: {
    type: 'object' as const,
    properties: {
      match: { type: 'string', description: 'the label of the matching video (C1 or C2), or "new"' },
      same_edit: { type: 'boolean', description: 'the same shots in the same order at the same moments' },
      colour_changed: { type: 'boolean', description: 'the colour/contrast/saturation was deliberately changed (graded) compared with the match' },
      confidence: { type: 'number', description: '0 to 1' },
      reasons: { type: 'array', items: { type: 'string' }, description: 'two to four short plain reasons a video editor would understand — name videos by their file names, never by their labels' },
    },
    required: ['match', 'same_edit', 'colour_changed', 'confidence', 'reasons'],
  },
}

async function askAi(newProbe: Probe, cands: { label: string; asset: string; name: string; where: string; probe: Probe; words: string[] }[], context: string): Promise<AiAnswer | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const content: unknown[] = [{ type: 'text', text: `NEW FILE — twelve frames, evenly from start to end:` }]
  for (const s of newProbe.samples) { const b = await frameBlock(s.url); if (b) content.push(b) }
  for (const c of cands) {
    content.push({ type: 'text', text: `${c.label} — ${c.where}: "${c.name}", frames at the same moments. Measured against the new file: ${c.words.join('; ') || 'no measures'}.` })
    for (const s of c.probe.samples) { const b = await frameBlock(s.url); if (b) content.push(b) }
  }
  content.push({ type: 'text', text: `${context}\n\nDecide which card video (if any) the new file is a cut of. Same edit = the same shots at the same moments; a re-cut = the same video edited differently (shots added, removed, trimmed, reordered); graded = the same edit with its colour deliberately changed (more contrast/saturation, a look). Most new files are NOT a cut of any card video: answer "new" unless the same people, places and shots clearly appear in both. Videos from one shoot share the set, the people and often an opening shot — that does not make them one video: a re-cut keeps most of the same shots in the same order and the same sound; judge the whole run of shots across all twelve frames, not one shared shot. READ THE ON-SCREEN TEXT in every frame — titles, captions, dish or product names, subtitles of what is said: the same titles and captions (even re-ordered, or with some added or cut) mean the same video re-edited; different titles or a different spoken script mean a different video, however alike the set. Name the text you matched or did not in your reasons. Different subject matter is always "new". Judge from the pictures and the measures, never from file names. Answer with the verdict tool.` })
  const anthropic = new Anthropic({ maxRetries: 1 })
  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 900, tools: [VERDICT_TOOL], tool_choice: { type: 'tool', name: 'verdict' },
    messages: [{ role: 'user', content: content as never }],
  }, { timeout: 90_000 })
  const tool = res.content.find(b => b.type === 'tool_use')
  if (!tool || tool.type !== 'tool_use') return null
  const raw = tool.input as Partial<AiAnswer>
  const byLabel = new Map(cands.map(c => [c.label, c.asset]))
  const match = typeof raw.match === 'string' ? (byLabel.get(raw.match.trim()) ?? (cands.some(c => c.asset === raw.match) ? raw.match : 'new')) : 'new'
  return {
    match, same_edit: raw.same_edit === true, colour_changed: raw.colour_changed === true,
    confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String).slice(0, 4) : [],
  }
}

/** the card's videos the scan compares against — every one (the name decides nothing), newest cut of each */
export function cardVideosOf(item: ContentItem): { url: string; asset: string; name: string; size: number | null }[] {
  const round = roundOf(item)
  return currentFiles(item).filter(f => !isRetiredAt(f, round) && isVideo({ mime: f.mime, name: f.name }) && /^https:\/\//.test(f.url))
    .slice(0, MAX_CARD_VIDEOS).map(f => ({ url: f.url, asset: assetIdOf(f), name: f.name, size: typeof f.size === 'number' ? f.size : null }))
}
const newKey = (row: DriveSeen) => `drive:${row.drive_file_id}:${row.md5 ?? row.revision ?? `${row.size}@${row.modified}`}`
const cardKey = (url: string) => `r2:${url}`

async function finish(seenId: string, scan: Record<string, unknown>, failed = false) {
  await table<DriveSeen>('drive_seen').claim(seenId, cur => {
    if (!cur) return null
    const was = (cur.scan as { was_locked?: boolean } | null)?.was_locked === true
    return { ...cur, state: failed ? 'failed' : was ? 'locked' : 'scanned', scan: { ...((cur.scan as object) ?? {}), ...scan, at: new Date().toISOString() }, updated_at: new Date().toISOString() } as DriveSeen
  })
}

/**
 * THE SCAN, IN STEPS — the drive-scan-file job runs each as its own step, so no one step runs out of time (live,
 * 21 Oct 2026: one step measuring five 4K card videos never finished):
 *   startScan → measureNewFile → measureCardVideo × each → decideScan
 */
export async function startScan(seenId: string): Promise<{ go: boolean; itemId?: string; note: string }> {
  const start = await table<DriveSeen>('drive_seen').claim(seenId, cur => {
    // a scan killed part-way is taken again after six minutes, never left "scanning" for ever
    const stale = cur?.state === 'scanning' && Date.now() - Date.parse(String((cur.scan as { started_at?: string } | null)?.started_at ?? cur.updated_at)) > 6 * 60_000
    if (!cur || (!['new', 'locked', 'failed'].includes(cur.state) && !stale)) return null
    if ((cur.scan as { kind?: string } | null)?.kind && cur.state === 'locked') return null   // scanned already, waiting
    const was = cur.state === 'locked' || (stale && (cur.scan as { was_locked?: boolean } | null)?.was_locked === true)
    const kept = (cur.scan as { duration_ms?: unknown } | null)?.duration_ms   // a rescan stays comparable to its siblings
    return { ...cur, state: 'scanning', scan: { steps: { measure: 'running' }, was_locked: was, started_at: new Date().toISOString(), ...(typeof kept === 'number' ? { duration_ms: kept } : {}) }, updated_at: new Date().toISOString() } as DriveSeen
  })
  if (!start.claimed) return { go: false, note: 'not waiting for a scan' }
  const row = start.row
  const item = await table<ContentItem>('content_items').get(row.item_id)
  if (!item) { await finish(seenId, { error: 'The card is gone' }, true); return { go: false, note: 'no card' } }
  // pictures and PDFs: matched by name only, and always asked
  if (!isVideo({ mime: row.mime, name: row.path })) {
    const c = rankCandidates({ id: row.drive_file_id, name: row.path, mime: row.mime }, cardFilesOf(item), 1)[0]
    await finish(seenId, { kind: c ? 'recut' : 'new_video', asset: c?.asset ?? null, confidence: 0.5, ask: true, reasons: ['Pictures and PDFs are matched by name — check it'], steps: { measure: 'skipped', sound: 'skipped', frames: 'skipped', colour: 'skipped', ai: 'skipped' } })
    return { go: false, note: 'not a video' }
  }
  return { go: true, itemId: item.id, note: 'started' }
}

export async function measureNewFile(seenId: string): Promise<{ ok: boolean }> {
  const row = await table<DriveSeen>('drive_seen').get(seenId)
  if (!row) return { ok: false }
  // our own stored copy when there is one — Drive is not read again (its per-file download cap, 22 Oct 2026)
  const stored = await storedCopyOf(row.drive_file_id, row.size)
  const probe = await probeVideo(stored?.url ?? drivePublicUrl(row.drive_file_id), newKey(row))
  if (!probe.durationMs) { await finish(seenId, { error: probe.error ?? 'The video could not be read', steps: { measure: 'failed' } }, true); return { ok: false } }
  await setSteps(seenId, { measure: 'done', sound: 'running' }, { duration_ms: probe.durationMs, frames: probe.samples.map(s => s.url), colour: probe.samples.map(s => ({ sat: s.satavg, ymin: s.ymin, ymax: s.ymax })) })
  return { ok: true }
}

/**
 * WHAT A NEW FILE IS COMPARED WITH (the owner, 21 Oct 2026, on Cecconi's): the card's videos; the other files in its
 * Drive links (Draft, v2, V3 and final of one video sit side by side before any is handed in); and the newest videos on
 * the same client's other Editor cards (one shoot folder held the cuts of three cards).
 */
type Comparable = { asset: string; name: string; where: string; url: string; key: string; size: number | null; otherCard: { id: string; title: string } | null }
async function comparablesOf(item: ContentItem, exceptSeen: string | null): Promise<Comparable[]> {
  const own: Comparable[] = cardVideosOf(item).map(v => ({ asset: v.asset, name: v.name, where: 'a video on this card', url: v.url, key: cardKey(v.url), size: v.size, otherCard: null }))
  const seen = await table<DriveSeen>('drive_seen').list({ where: r => r.item_id === item.id && r.id !== exceptSeen })
  const drive: Comparable[] = seen
    // EVERY other video in the card's Drive links, measured before any decision (each once, cached — no AI cost), so
    // every file on a card is judged against the same set (the owner, 21 Oct 2026: "checking 7 videos some 10");
    // a taken file is on the card already and is compared as the card's video
    .filter(r => ['new', 'scanning', 'scanned', 'locked'].includes(r.state) && isVideo({ mime: r.mime, name: r.path }) && !isFootage({ name: r.path }))
    .map(r => ({ asset: `seen:${r.id}`, name: r.path, where: "another file in this card's Drive links", url: drivePublicUrl(r.drive_file_id), key: newKey(r), size: r.size ?? null, otherCard: null }))
  const kinds = new Map((await table<WorkKind>('work_kinds').list()).map(k => [k.id, k.slug]))
  const siblings = (await table<ContentItem>('content_items').list({
    where: r => r.client_id === item.client_id && r.id !== item.id && !!laneOf(r.status) && isEditorCard(r as never, kinds.get(String(r.work_kind_id ?? ''))),
  })).sort((x, y) => String(y.updated_at ?? '').localeCompare(String(x.updated_at ?? '')))
  const other: Comparable[] = []
  for (const s of siblings) for (const v of cardVideosOf(s)) {
    if (other.length >= MAX_OTHER_VIDEOS) break
    other.push({ asset: `card:${s.id}:${v.asset}`, name: v.name, where: `a video on another card of this client, "${s.title ?? 'untitled'}"`, url: v.url, key: cardKey(v.url), size: v.size, otherCard: { id: s.id, title: String(s.title ?? 'untitled') } })
  }
  return [...own, ...drive, ...other]
}

/** every video to measure before deciding: the card's, its other Drive files and the client's other cards' */
export async function cardVideoUrls(itemId: string, exceptSeen: string | null = null): Promise<{ url: string; key: string }[]> {
  const item = await table<ContentItem>('content_items').get(itemId)
  return item ? (await comparablesOf(item, exceptSeen)).map(c => ({ url: c.url, key: c.key })) : []
}

export async function measureCardVideo(url: string, key: string = cardKey(url)): Promise<{ ok: boolean; ms: number | null }> {
  const p = await probeVideo(url, key)
  return { ok: !!p.durationMs, ms: p.durationMs }
}

export async function decideScan(seenId: string): Promise<{ ok: boolean; note: string }> {
  const row = await table<DriveSeen>('drive_seen').get(seenId)
  if (!row || row.state !== 'scanning') return { ok: false, note: 'not scanning' }
  try {
    const item = await table<ContentItem>('content_items').get(row.item_id)
    if (!item) { await finish(seenId, { error: 'The card is gone' }, true); return { ok: false, note: 'no card' } }
    const source = await table<DriveSource>('drive_sources').get(row.source_id).catch(() => null)
    const adder = source?.added_by ? await table<TeamUser>('team_users').get(source.added_by).catch(() => null) : null
    const byColourist = adder?.colourist === true
    const gradedFolder = GRADED_FOLDER.test(row.path)
    const probe = await probeVideo(drivePublicUrl(row.drive_file_id), newKey(row))   // cached by measureNewFile
    if (!probe.durationMs) { await finish(seenId, { error: probe.error ?? 'The video could not be read' }, true); return { ok: false, note: 'unreadable' } }
    const pool = await comparablesOf(item, seenId)
    const measured = await Promise.all(pool.map(async c => ({ c, probe: await probeVideo(c.url, c.key) })))   // cached
    const compared = measured.filter(m => m.probe.durationMs).map(m => ({ ...m.c, probe: m.probe, s: compareProbes(probe, m.probe) as Signals }))
      .sort((a, b) => signalScore(b.s) - signalScore(a.s))
    await setSteps(seenId, { sound: 'done', frames: 'done', colour: 'done', ai: compared.length ? 'running' : 'skipped' }, { checked: compared.length, compared: compared.slice(0, 5).map(c => ({ asset: c.asset, name: c.name, where: c.where, ...c.s })) })
    // THE SAME FILE AGAIN: the same size to the byte and the same length is one file saved twice (live, 21 Oct 2026:
    // five New Menu Medley files of 177,601,535 bytes each). It is not judged against its twins — it takes the
    // verdict one of them already has, or is judged against everything else, so the whole group stays tied to the
    // video it is a version of (on another card, for New Menu Medley) and the AI is asked once for all of them
    const twins = row.size ? compared.filter(c => c.size === row.size && c.s.lengthGapMs !== null && c.s.lengthGapMs <= 150 && c.asset.startsWith('seen:')) : []
    if (twins.length) {
      const twinRows = await Promise.all(twins.map(t => table<DriveSeen>('drive_seen').get(t.asset.slice(5)).catch(() => null)))
      const decided = twinRows.find(r => r?.state === 'scanned' && (r.scan as { kind?: string } | null)?.kind)
      if (decided) {
        const d = decided.scan as Record<string, unknown>
        await finish(seenId, {
          pool: pool.length, checked: compared.length, kind: d.kind, asset: d.asset ?? null, other_card: d.other_card ?? null, confidence: d.confidence, ask: d.ask,
          same_as: `seen:${decided.id}`, model: 'same file as another — its verdict',
          reasons: [`The same file as ${decided.path} (same size to the byte, same length)`, ...((d.reasons as string[] | undefined) ?? [])].slice(0, 6),
          words: `${String(d.words ?? '').split(' — same file as ')[0]} — same file as ${decided.path}`,
          steps: { measure: 'done', sound: 'done', frames: 'done', colour: 'done', ai: 'skipped' },
        })
        return { ok: true, note: `same as ${decided.id}` }
      }
    }
    const twinSet = new Set(twins.map(t => t.asset))
    for (let i = compared.length - 1; i >= 0; i--) if (twinSet.has(compared[i].asset)) compared.splice(i, 1)
    const sameAs = twins[0]?.asset ?? null
    // nothing to compare with: the first cut of a new video, said plainly, with no AI call to describe it
    if (!compared.length) {
      await finish(seenId, { pool: pool.length, same_as: sameAs, kind: 'new_video', asset: null, confidence: 0.9, ask: false, reasons: ['Nothing on this card, in its Drive links or on the client’s other cards to compare it with yet — the first cut of a video'], model: 'measures only', words: KIND_WORDS.new_video, steps: { measure: 'done', sound: 'done', frames: 'done', colour: 'done', ai: 'skipped' } })
      return { ok: true, note: 'new_video (nothing to compare)' }
    }
    // the closest two, at twelve frames each: the AI sees whole runs of shots, not glimpses of three
    const top = compared.slice(0, 2).map((c, i) => ({ ...c, label: `C${i + 1}`, words: comparisonWords(c.s) }))
    const measuresSay = signalAnswer(top[0] ? { asset: top[0].asset, s: top[0].s } : null)
    let ai: AiAnswer | null = null
    let model = 'measures only'
    let aiError: string | null = null
    try {
      ai = await askAi(probe, top, `The card is at "${String(item.status)}". The link was added by ${adder ? `${adder.name ?? adder.email}${byColourist ? ' (the colourist)' : ''}` : 'someone'}; the file sits in "${row.path}".`)
      if (ai) model = MODEL
      else aiError = process.env.ANTHROPIC_API_KEY ? 'The AI gave no verdict' : 'No AI key on this server'
    } catch (e) {
      // why the AI was not asked, kept on the scan so it is seen, not guessed at
      ai = null
      aiError = (e instanceof Error ? e.message : String(e)).slice(0, 200)
    }
    let answer = ai ?? measuresSay
    // held to the measures on the AI's OWN confidence, before a disagreement lowers it
    const matched = top.find(t => t.asset === answer.match)
    const held = heldToMeasures(answer, matched?.s ?? null, matched?.probe.durationMs && probe.durationMs ? Math.min(matched.probe.durationMs, probe.durationMs) : null)
    if (held !== answer) answer = held
    else if (ai && (ai.match !== measuresSay.match || ai.same_edit !== measuresSay.same_edit)) answer = { ...answer, confidence: Math.min(answer.confidence, 0.6) }
    const candidates = top.map(t => ({ asset: t.asset, name: t.name, score: signalScore(t.s), why: t.words }))
    const v = verdictOf(answer, { status: item.status, candidates, byColourist, gradedFolder, lengthGapMs: top.find(t => t.asset === answer.match)?.s.lengthGapMs ?? null })
    const best = top.find(t => t.asset === v.asset)
    const ask = v.ask || !!best?.otherCard   // a cut of another card's video is the person's call
    const said = namedReasons([
      ...(best?.otherCard ? [`This looks like a video on another card: “${best.otherCard.title}”`] : []),
      ...(best ? comparisonWords(best.s) : []), ...v.reasons,
    ], new Map(top.map(t => [t.label, t.name])))
    const reasons = said.filter((x, i, arr) => x && arr.indexOf(x) === i).slice(0, 6)
    const words = `${KIND_WORDS[v.kind]}${best ? ` of ${best.name}` : ''}${best?.otherCard ? ` — on “${best.otherCard.title}”` : best?.asset.startsWith('seen:') ? ' (in Drive)' : ''}`
    await finish(seenId, { pool: pool.length, same_as: sameAs, kind: v.kind, asset: v.asset, other_card: best?.otherCard ?? null, confidence: v.confidence, ask, reasons, model, ai_error: aiError, words, steps: { measure: 'done', sound: 'done', frames: 'done', colour: 'done', ai: ai ? 'done' : 'skipped' } })
    return { ok: true, note: `${v.kind}${v.asset ? ` of ${v.asset}` : ''}` }
  } catch (e) {
    await finish(seenId, { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }, true).catch(() => undefined)
    return { ok: false, note: 'failed' }
  }
}

/**
 * THE SCANS TO RUN AGAIN once a card's scans have all finished: a file scanned before its siblings in Drive were
 * measured was judged against fewer videos than the rest. Each is set back to "new" (its length kept) and returned; a
 * rescan checks against the full set, so the next pass finds nothing to redo.
 */
export async function staleScans(itemId: string): Promise<string[]> {
  const rows = await table<DriveSeen>('drive_seen').list({ where: r => r.item_id === itemId, fresh: true })
  if (rows.some(r => r.state === 'new' || r.state === 'scanning')) return []   // not the last one yet
  const item = await table<ContentItem>('content_items').get(itemId)
  if (!item) return []
  // only a file called new can change: one already matched to a video keeps its match (each rescan is an AI call —
  // the owner, 21 Oct 2026: "u are burning my token prices")
  const scanned = rows.filter(r => r.state === 'scanned' && typeof (r.scan as { pool?: unknown } | null)?.pool === 'number' && (r.scan as { kind?: string }).kind === 'new_video')
  if (!scanned.length) return []
  const full = (await comparablesOf(item, null)).length   // every file's set is this, less itself when it is a Drive file
  const out: string[] = []
  for (const r of scanned) {
    const pool = (r.scan as { pool: number }).pool
    if (pool >= full - 1) continue
    const d = (r.scan as { duration_ms?: unknown }).duration_ms
    const put = await table<DriveSeen>('drive_seen').claim(r.id, cur => cur?.state === 'scanned'
      ? { ...cur, state: 'new', scan: typeof d === 'number' ? { duration_ms: d } : null, updated_at: new Date().toISOString() } as DriveSeen : null)
    if (put.claimed) out.push(r.id)
  }
  return out
}
