import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { table } from '@/lib/db'
import type { ContentItem, DriveSeen, DriveSource, TeamUser } from '@/lib/db-types'
import { assetIdOf, currentFiles, isRetiredAt } from './final-files-core'
import { roundOf } from './edit-round-core'
import {
  GRADED_FOLDER, KIND_WORDS, isVideo, rankCandidates, signalAnswer, signalScore, verdictOf,
  type AiAnswer, type ScanStepKey, type Signals, type StepState,
} from './drive-scan-core'
import { compareProbes, comparisonWords } from './scan-measure-core'
import { drivePublicUrl, probeVideo, type Probe } from './scan-measure'
import { cardFilesOf } from './drive-scan'

/**
 * THE AI SCAN OF ONE NEW FILE (the owner, 21 Oct 2026: "we need ai everytime a file is modified and crosschecks with
 * the current submitted files … my only question is how u would know its graded").
 *
 *   1 measure — the new video's length, four frames, their colour, and its sound at those moments (scan-measure.ts);
 *   2 sound   — against every video on the card (measured once, cached): the same sound at the same moments is the
 *               same edit; the name of the file is never evidence;
 *   3 frames  — the best two are shown to the AI frame for frame;
 *   4 colour  — contrast and saturation moved with the shots unchanged is a grade;
 *   5 AI      — Claude looks at the frames and the measures and says which video and what it is, with reasons.
 *
 * Each step is written to the row as it runs, so the card page shows it happening. The verdict only SUGGESTS: a person
 * confirms (drive-scan-core.verdictOf asks whenever the AI and the context disagree). Nothing here touches a card.
 */

const MODEL = process.env.DRIVE_SCAN_MODEL || 'claude-haiku-4-5'
const MAX_CARD_VIDEOS = 12

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
      match: { type: 'string', description: 'the id of the matching video (C1 or C2 as labelled), or "new"' },
      same_edit: { type: 'boolean', description: 'the same shots in the same order at the same moments' },
      colour_changed: { type: 'boolean', description: 'the colour/contrast/saturation was deliberately changed (graded) compared with the match' },
      confidence: { type: 'number', description: '0 to 1' },
      reasons: { type: 'array', items: { type: 'string' }, description: 'two to four short plain reasons a video editor would understand' },
    },
    required: ['match', 'same_edit', 'colour_changed', 'confidence', 'reasons'],
  },
}

async function askAi(newProbe: Probe, cands: { label: string; asset: string; name: string; probe: Probe; words: string[] }[], context: string): Promise<AiAnswer | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const content: unknown[] = [{ type: 'text', text: `NEW FILE — four frames at 10%, 35%, 60% and 85% of its length:` }]
  for (const s of newProbe.samples) { const b = await frameBlock(s.url); if (b) content.push(b) }
  for (const c of cands) {
    content.push({ type: 'text', text: `${c.label} — the card's video "${c.name}", frames at the same moments. Measured against the new file: ${c.words.join('; ') || 'no measures'}.` })
    for (const s of c.probe.samples) { const b = await frameBlock(s.url); if (b) content.push(b) }
  }
  content.push({ type: 'text', text: `${context}\n\nDecide which card video (if any) the new file is a cut of. Same edit = the same shots at the same moments; a re-cut = the same video edited differently (shots added, removed, trimmed, reordered); graded = the same edit with its colour deliberately changed (more contrast/saturation, a look). Judge from the pictures and the measures, never from file names. Answer with the verdict tool.` })
  const anthropic = new Anthropic({ maxRetries: 1 })
  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 600, tools: [VERDICT_TOOL], tool_choice: { type: 'tool', name: 'verdict' },
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

/** run in small batches: a card's videos are measured three at a time */
async function inBatches<T, R>(xs: readonly T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < xs.length; i += n) out.push(...await Promise.all(xs.slice(i, i + n).map(f)))
  return out
}

export async function scanSeen(seenId: string): Promise<{ ok: boolean; note: string }> {
  const seenT = table<DriveSeen>('drive_seen')
  // claim it for this scan — one scan at a time per file
  let wasLocked = false
  const start = await seenT.claim(seenId, cur => {
    if (!cur || !['new', 'locked', 'failed'].includes(cur.state)) return null
    if ((cur.scan as { kind?: string } | null)?.kind && cur.state === 'locked') return null   // already scanned, waiting
    wasLocked = cur.state === 'locked'
    return { ...cur, state: 'scanning', scan: { steps: { measure: 'running' }, was_locked: wasLocked, started_at: new Date().toISOString() }, updated_at: new Date().toISOString() } as DriveSeen
  })
  if (!start.claimed) return { ok: false, note: 'not waiting for a scan' }
  const row = start.row
  const settle = async (scan: Record<string, unknown>, failed = false) => {
    await seenT.claim(seenId, cur => cur ? { ...cur, state: failed ? 'failed' : wasLocked ? 'locked' : 'scanned', scan: { ...(cur.scan as object ?? {}), ...scan, at: new Date().toISOString() }, updated_at: new Date().toISOString() } as DriveSeen : null)
  }
  try {
    const item = await table<ContentItem>('content_items').get(row.item_id)
    if (!item) { await settle({ error: 'The card is gone' }, true); return { ok: false, note: 'no card' } }
    const source = await table<DriveSource>('drive_sources').get(row.source_id).catch(() => null)
    const adder = source?.added_by ? await table<TeamUser>('team_users').get(source.added_by).catch(() => null) : null
    const byColourist = adder?.colourist === true
    const gradedFolder = GRADED_FOLDER.test(row.path)

    // pictures and PDFs: matched by name only, and always asked
    if (!isVideo({ mime: row.mime, name: row.path })) {
      const c = rankCandidates({ id: row.drive_file_id, name: row.path, mime: row.mime }, cardFilesOf(item), 1)[0]
      await settle({ kind: c ? 'recut' : 'new_video', asset: c?.asset ?? null, confidence: 0.5, ask: true, reasons: ['Pictures and PDFs are matched by name — check it'], steps: { measure: 'skipped', sound: 'skipped', frames: 'skipped', colour: 'skipped', ai: 'skipped' } })
      return { ok: true, note: 'not a video' }
    }

    // 1 measure the new file
    const key = `drive:${row.drive_file_id}:${row.md5 ?? row.revision ?? `${row.size}@${row.modified}`}`
    const probe = await probeVideo(drivePublicUrl(row.drive_file_id), key)
    if (!probe.durationMs) { await settle({ error: probe.error ?? 'The video could not be read', steps: { measure: 'failed' } }, true); return { ok: false, note: 'unreadable' } }
    await setSteps(seenId, { measure: 'done', sound: 'running' }, { duration_ms: probe.durationMs, frames: probe.samples.map(s => s.url), colour: probe.samples.map(s => ({ sat: s.satavg, ymin: s.ymin, ymax: s.ymax })) })

    // 2 the card's videos, measured (cached) and compared — every one, the name decides nothing
    const round = roundOf(item)
    const videos = currentFiles(item).filter(f => !isRetiredAt(f, round) && isVideo({ mime: f.mime, name: f.name }) && /^https:\/\//.test(f.url)).slice(0, MAX_CARD_VIDEOS)
    const measured = await inBatches(videos, 3, async f => ({ f, probe: await probeVideo(f.url, `r2:${f.url}`) }))
    const compared = measured.filter(m => m.probe.durationMs).map(m => ({ asset: assetIdOf(m.f), name: m.f.name, probe: m.probe, s: compareProbes(probe, m.probe) as Signals }))
      .sort((a, b) => signalScore(b.s) - signalScore(a.s))
    await setSteps(seenId, { sound: 'done', frames: 'running' }, { compared: compared.slice(0, 5).map(c => ({ asset: c.asset, name: c.name, ...c.s })) })

    // 3–4 the best two, frame for frame, with the colour readings
    const top = compared.slice(0, 2).map((c, i) => ({ label: `C${i + 1}`, asset: c.asset, name: c.name, probe: c.probe, words: comparisonWords(c.s), s: c.s }))
    await setSteps(seenId, { frames: 'done', colour: 'done', ai: 'running' })

    // 5 the AI decides, checked against the measures
    const measuresSay = signalAnswer(top[0] ? { asset: top[0].asset, s: top[0].s } : null)
    let ai: AiAnswer | null = null
    let model = 'measures only'
    try {
      ai = await askAi(probe, top, `The card is at "${String(item.status)}". The link was added by ${adder ? `${adder.name ?? adder.email}${byColourist ? ' (the colourist)' : ''}` : 'someone'}; the file sits in "${row.path}".`)
      if (ai) model = MODEL
    } catch { ai = null }
    const answer = ai ?? measuresSay
    if (ai && (ai.match !== measuresSay.match || ai.same_edit !== measuresSay.same_edit)) answer.confidence = Math.min(answer.confidence, 0.6)
    const candidates = top.map(t => ({ asset: t.asset, name: t.name, score: signalScore(t.s), why: t.words }))
    const v = verdictOf(answer, { status: item.status, candidates, byColourist, gradedFolder })
    const best = top.find(t => t.asset === v.asset)
    const reasons = [...(best ? comparisonWords(best.s) : []), ...v.reasons].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 6)
    await settle({ kind: v.kind, asset: v.asset, confidence: v.confidence, ask: v.ask, reasons, model, words: `${KIND_WORDS[v.kind]}${best ? ` of ${best.name}` : ''}`, steps: { measure: 'done', sound: 'done', frames: 'done', colour: 'done', ai: ai ? 'done' : 'skipped' } })
    return { ok: true, note: `${v.kind}${v.asset ? ` of ${v.asset}` : ''}` }
  } catch (e) {
    await settle({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }, true).catch(() => undefined)
    return { ok: false, note: 'failed' }
  }
}
