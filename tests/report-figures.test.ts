// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { generateJSON } from '@tiptap/html'
import { reportEditorExtensions } from '@/app/lib/report-editor-schema'
import { docToMarkdown, type DocNode } from '@/app/lib/report-markdown'
import { docToHtml, readDoc } from '@/app/lib/report-doc'
import { allFigures, carriesFigures, figureHtml, figureName, figureNode, figuresIn, hoistFigures, readFigure, sheetParts, tileList, type Figure } from '@/app/lib/report-figures'
import type { PlatformFigures, ReportData } from '@/app/lib/client-report-core'

const platform = (name: string, over: Partial<PlatformFigures> = {}): PlatformFigures => ({
  platform: name, handle: 'acct', views: 100, reach: 50, interactions: 10, profileVisits: 4, linkTaps: 0,
  followers: { start: 10, end: 12, previousEnd: 10, gained: 2 },
  viewsFromFollowers: null, viewsFromNonFollowers: null,
  previous: { views: 80, reach: 40, interactions: 9 },
  daily: [{ date: '2026-09-01', views: 5, engagement: 1, followersGained: 0 }],
  topPosts: [], ...over,
} as unknown as PlatformFigures)

const data = (platforms: PlatformFigures[], over: Partial<ReportData> = {}): ReportData =>
  ({ month: '2026-09', platforms, audience: null, candidates: [], ...over } as unknown as ReportData)

const p = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const fig = (kind: Figure['kind'], platformName = '', hide: string[] = []): Figure => ({ kind, platform: platformName, hide })
const saved = (content: DocNode[], figures = true) => JSON.stringify({ type: 'doc', content, ...(figures ? { figures: true } : {}) })
const kinds = (parts: ReturnType<typeof sheetParts>) => parts.map(x => (x.type === 'figure' ? `${x.figure.kind}:${x.figure.platform}` : 'words'))

describe('which figures a report can show', () => {
  it('lists them in the usual order, and leaves out any with no numbers behind it', () => {
    const d = data([platform('instagram'), platform('linkedin', { daily: [], previous: { views: null, reach: null, interactions: null } } as never)])
    expect(allFigures(d, null).map(f => `${f.kind}:${f.platform}`)).toEqual([
      'summary:', 'platform:instagram', 'tiles:instagram', 'daily:instagram', 'compare:instagram', 'platform:linkedin', 'tiles:linkedin',
    ])
  })
  it('names each one in plain words', () => {
    expect(figureName(fig('tiles', 'instagram'))).toBe('Instagram number tiles')
    expect(figureName(fig('summary'))).toBe('Summary table')
  })
  it('Instagram has two more tiles than the rest', () => {
    expect(tileList(platform('instagram')).map(t => t.label)).toEqual(['Views', 'Accounts reached', 'Interactions', 'Followers gained', 'Profile visits', 'Bio link taps'])
    expect(tileList(platform('linkedin'))).toHaveLength(4)
  })
})

describe('a figure in the document says which figure, never a number', () => {
  it('reads back only a kind it knows, and only words as its parts', () => {
    expect(readFigure({ kind: 'tiles', platform: 'instagram', hide: ['Views', 7, null] })).toEqual({ kind: 'tiles', platform: 'instagram', hide: ['Views'] })
    expect(readFigure({ kind: 'script' })).toBeNull()
    expect(readFigure(null)).toBeNull()
  })
  it('the editor reads the block back as the same figure', () => {
    const f = fig('tiles', 'instagram', ['Bio link taps'])
    const json = generateJSON(figureHtml(f) + '<p>Words</p>', reportEditorExtensions()) as DocNode
    expect(json.content?.[0]).toEqual(figureNode(f))
    expect(figuresIn(json)).toEqual([f])
  })
  it('is left out of the Markdown and of the written report’s HTML: it is not words', () => {
    const doc: DocNode = { type: 'doc', content: [figureNode(fig('tiles', 'instagram')), p('Words')] }
    expect(docToMarkdown(doc)).toBe('Words')
    expect(docToHtml(doc)).toBe('<p>Words</p>')
  })
  it('a figure dropped inside a list is lifted out to sit after it', () => {
    const doc: DocNode = { type: 'doc', content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('one'), figureNode(fig('daily', 'instagram'))] }] }, p('after'),
    ] }
    expect(hoistFigures(doc).content?.map(n => n.type)).toEqual(['bulletList', 'reportFigure', 'paragraph'])
    expect(figuresIn(hoistFigures(doc))).toHaveLength(1)
  })
})

describe('the report, top to bottom', () => {
  const d = data([platform('instagram')])
  it('a report nobody has rearranged: every figure in the usual order, then the words', () => {
    expect(kinds(sheetParts({ body: '# Summary\n\nWords', body_doc: null }, d))).toEqual(['summary:', 'platform:instagram', 'tiles:instagram', 'daily:instagram', 'compare:instagram', 'words'])
    // a document saved before figures were blocks is drawn the same way
    expect(kinds(sheetParts({ body: 'x', body_doc: saved([p('Words')], false) }, d))).toEqual(['summary:', 'platform:instagram', 'tiles:instagram', 'daily:instagram', 'compare:instagram', 'words'])
  })
  it('a report that carries its figures is drawn in its own order', () => {
    const doc = saved([p('Intro'), figureNode(fig('tiles', 'instagram', ['Views'])), p('Middle'), p('More'), figureNode(fig('summary'))])
    const parts = sheetParts({ body: 'x', body_doc: doc }, d)
    expect(kinds(parts)).toEqual(['words', 'tiles:instagram', 'words', 'summary:'])
    expect(parts[2]).toEqual({ type: 'html', html: '<p>Middle</p><p>More</p>' })
    expect(parts[1]).toEqual({ type: 'figure', figure: fig('tiles', 'instagram', ['Views']) })
  })
  it('with every figure taken out, none comes back by itself', () => {
    const doc = saved([p('Only words')])
    expect(carriesFigures(readDoc(doc))).toBe(true)
    expect(kinds(sheetParts({ body: 'x', body_doc: doc }, d))).toEqual(['words'])
  })
  it('a figure with no numbers this month, or for an account not in the report, is skipped', () => {
    const doc = saved([figureNode(fig('audience')), figureNode(fig('tiles', 'facebook')), figureNode(fig('tiles', 'instagram'))])
    expect(kinds(sheetParts({ body: 'x', body_doc: doc }, d))).toEqual(['tiles:instagram'])
  })
})
