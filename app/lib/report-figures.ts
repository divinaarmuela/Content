import { platformLabel, type PlatformFigures, type ReportData } from './client-report-core'
import { readPostsExplained } from './post-breakdown-core'
import { docToHtml, readDoc, reportBodyHtml } from './report-doc'
import { viewsByType } from './report-charts-core'
import type { DocNode } from './report-markdown'

/**
 * THE REPORT'S FIGURES ARE BLOCKS IN THE REPORT (the owner, 20 Nov 2026, of the summary table, the tiles and the
 * charts: "this should be editable … please make it easy to use"). They used to be drawn in a fixed order above the
 * written report, outside the editor, so nothing about them could be changed. Each one is now a block in the report's
 * own document: it can be moved up or down between the paragraphs, taken out, and put back.
 *
 * WHAT A BLOCK HOLDS IS WHICH FIGURE, NEVER THE NUMBERS. The document says "Instagram's tiles go here"; the numbers are
 * read from the month's figures every time the report is drawn. Nobody can type a number that the account did not
 * give — the one thing a report must never get wrong.
 *
 * Pure: the editor, the preview and the PDF all ask this file what is in the report and in what order.
 */

export const FIGURE_NODE = 'reportFigure'

export const FIGURE_KINDS = ['summary', 'platform', 'tiles', 'daily', 'compare', 'split', 'posts', 'why', 'audience'] as const
export type FigureKind = typeof FIGURE_KINDS[number]

/** a figure in the report: which one, for which account ('' = the whole report), and the tiles left out of it */
export type Figure = { kind: FigureKind; platform: string; hide: string[] }

/** a figure read back from the document: only a kind this file knows, and only words as its other parts */
export function readFigure(attrs: Record<string, unknown> | null | undefined): Figure | null {
  const kind = String(attrs?.kind ?? '') as FigureKind
  if (!FIGURE_KINDS.includes(kind)) return null
  const hide = Array.isArray(attrs?.hide) ? (attrs!.hide as unknown[]).filter((h): h is string => typeof h === 'string' && h.length <= 60).slice(0, 20) : []
  return { kind, platform: String(attrs?.platform ?? '').slice(0, 40), hide }
}

export const figureKey = (f: Pick<Figure, 'kind' | 'platform'>) => `${f.kind}:${f.platform}`

/** the figure's name, in the team's words (the Add menu, and the bar over a block in the editor) */
export function figureName(f: Pick<Figure, 'kind' | 'platform'>): string {
  const who = f.platform ? platformLabel(f.platform) : ''
  switch (f.kind) {
    case 'summary': return 'Summary table'
    case 'platform': return `${who} heading`
    case 'tiles': return `${who} number tiles`
    case 'daily': return `${who} chart: views each day`
    case 'compare': return `${who} chart: this month beside last month`
    case 'split': return `${who} chart: who saw it`
    case 'posts': return `${who} top posts`
    case 'why': return `${who}: why the posts worked`
    case 'audience': return 'Audience'
  }
}

/** the six numbers on an account's tiles (Instagram has two more than the rest) */
export function tileList(p: PlatformFigures): { label: string; value: number | null; was: number | null }[] {
  return [
    { label: 'Views', value: p.views, was: p.previous.views },
    { label: 'Accounts reached', value: p.reach, was: p.previous.reach },
    { label: 'Interactions', value: p.interactions, was: p.previous.interactions },
    { label: 'Followers gained', value: p.followers.gained, was: p.followers.previousGained ?? null },
    ...(p.platform === 'instagram' ? [{ label: 'Profile visits', value: p.profileVisits, was: null }, { label: 'Bio link taps', value: p.linkTaps, was: null }] : []),
  ]
}

type ReportLike = { body?: string | null; body_doc?: unknown; posts_explained?: unknown } | null | undefined

/** IS THERE ANYTHING TO DRAW? A chart with no numbers behind it is not offered, and is skipped if the document asks for it */
export function figureHasData(f: Pick<Figure, 'kind' | 'platform'>, data: ReportData, report: ReportLike): boolean {
  if (f.kind === 'summary') return data.platforms.length > 0
  if (f.kind === 'audience') return !!data.audience
  const p = data.platforms.find(x => x.platform === f.platform)
  if (!p) return false
  switch (f.kind) {
    case 'platform': case 'tiles': return true
    case 'daily': return p.daily.some(d => d.views > 0)
    case 'compare': return [p.previous.views, p.previous.reach, p.previous.interactions].some(v => v != null)
    case 'split': return viewsByType(data.candidates ?? [], p.platform).length > 1 || (p.viewsFromFollowers != null && p.viewsFromNonFollowers != null)
    case 'posts': return p.topPosts.length > 0
    case 'why': return p.platform === 'instagram' && (readPostsExplained(report?.posts_explained)?.items ?? []).some(i => i.breakdown)
    default: return false
  }
}

/** EVERY FIGURE THIS REPORT CAN SHOW, IN THE USUAL ORDER: the summary, then each account top to bottom, then the audience */
export function allFigures(data: ReportData, report: ReportLike): Figure[] {
  const list: Pick<Figure, 'kind' | 'platform'>[] = [
    { kind: 'summary', platform: '' },
    ...data.platforms.flatMap(p => (['platform', 'tiles', 'daily', 'compare', 'split', 'posts', 'why'] as const).map(kind => ({ kind, platform: p.platform }))),
    { kind: 'audience', platform: '' },
  ]
  return list.filter(f => figureHasData(f, data, report)).map(f => ({ ...f, hide: [] }))
}

export const figureNode = (f: Figure): DocNode => ({ type: FIGURE_NODE, attrs: { kind: f.kind, platform: f.platform, hide: f.hide } })

/** the same block as the HTML the editor reads (a report that is still Markdown is opened from HTML) */
export function figureHtml(f: Figure): string {
  const q = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<div data-report-figure="" data-kind="${q(f.kind)}" data-platform="${q(f.platform)}" data-hide="${q(JSON.stringify(f.hide))}"></div>`
}

/** a document that already carries its figures (so one with every figure taken out is not given them all back) */
export const carriesFigures = (doc: DocNode | null | undefined): boolean => !!doc && (doc as { figures?: unknown }).figures === true

/** which figures are in the document now */
export function figuresIn(doc: DocNode | null | undefined): Figure[] {
  const out: Figure[] = []
  const walk = (n: DocNode) => { if (n.type === FIGURE_NODE) { const f = readFigure(n.attrs); if (f) out.push(f) } else (n.content ?? []).forEach(walk) }
  ;(doc?.content ?? []).forEach(walk)
  return out
}

/**
 * A FIGURE IS A WHOLE-WIDTH PIECE OF THE PAGE, NEVER INSIDE SOMETHING. One dropped into a list, a table cell or a
 * folding section is lifted out to sit straight after it — so what the editor shows is what the PDF draws.
 */
export function hoistFigures(doc: DocNode): DocNode {
  const lifted = (n: DocNode): { node: DocNode; out: DocNode[] } => {
    if (!n.content) return { node: n, out: [] }
    const out: DocNode[] = []
    const content: DocNode[] = []
    for (const c of n.content) {
      if (c.type === FIGURE_NODE) { out.push(c); continue }
      const r = lifted(c)
      content.push(r.node); out.push(...r.out)
    }
    return { node: { ...n, content }, out }
  }
  const content: DocNode[] = []
  for (const n of doc.content ?? []) {
    if (n.type === FIGURE_NODE) { content.push(n); continue }
    const r = lifted(n)
    content.push(r.node, ...r.out)
  }
  return { ...doc, content }
}

/** a piece of the printed report: written words, or one figure */
export type SheetPart = { type: 'html'; html: string } | { type: 'figure'; figure: Figure }

/**
 * THE REPORT, TOP TO BOTTOM. A report whose document carries its figures is drawn in the document's own order. Any
 * other (still Markdown, or edited before 20 Nov 2026) is drawn as it always was: every figure in the usual order,
 * then the written report.
 */
export function sheetParts(report: ReportLike, data: ReportData): SheetPart[] {
  const doc = readDoc(report?.body_doc)
  if (!doc || !carriesFigures(doc)) {
    const html = report?.body || doc ? reportBodyHtml(report) : ''
    return [...allFigures(data, report).map(figure => ({ type: 'figure' as const, figure })), ...(html ? [{ type: 'html' as const, html }] : [])]
  }
  const parts: SheetPart[] = []
  let run: DocNode[] = []
  const flush = () => { if (run.length) { const html = docToHtml({ type: 'doc', content: run }); if (html) parts.push({ type: 'html', html }); run = [] } }
  for (const n of hoistFigures(doc).content ?? []) {
    if (n.type !== FIGURE_NODE) { run.push(n); continue }
    flush()
    const figure = readFigure(n.attrs)
    if (figure && figureHasData(figure, data, report)) parts.push({ type: 'figure', figure })
  }
  flush()
  return parts
}
