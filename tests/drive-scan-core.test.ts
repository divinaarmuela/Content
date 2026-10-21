import { describe, expect, it } from 'vitest'
import {
  contentKey, firstState, isFootage, nameStem, rankCandidates, seenId, stageRule, unseen, verdictOf, heldToMeasures, cardLinksOf,
  type CardFile, type SeenFile,
} from '../app/lib/drive-scan-core'
import { cardFace, laneOf, stepOf } from '../app/lib/editor-preview-core'

const file = (over: Partial<SeenFile> = {}): SeenFile => ({ id: 'd1', name: 'Reels/Pasta.mp4', mime: 'video/mp4', md5: 'aaa', ...over })
const card: CardFile[] = [
  { id: 'f1', asset: 'A1', name: 'Pasta.mp4', drive_file_id: 'd1', drive_md5: 'aaa', version: 1, duration_ms: 30_000 },
  { id: 'f2', asset: 'A2', name: 'Pod 2.mp4', drive_file_id: 'd2', drive_md5: 'bbb', version: 1, duration_ms: 45_000 },
]

describe('only new or changed files are new (the owner, 21 Oct 2026)', () => {
  it('a re-export over the same Drive file is seen again; the same file at the same content is not', () => {
    const known = new Set([seenId('c', file())])
    expect(unseen('c', [file()], known)).toHaveLength(0)
    expect(unseen('c', [file({ md5: 'NEW' })], known)).toHaveLength(1)
  })
  it('the content key falls back to the revision, then size and change time', () => {
    expect(contentKey({ md5: 'x' })).toBe('mx')
    expect(contentKey({ revision: 'r9' })).toBe('rr9')
    expect(contentKey({ size: 10, modified: '2026-10-21T01:02:03Z' })).toBe('s10@20261021010203')
  })
})

describe('the state a file starts in', () => {
  it('already on the card is taken; the same bytes elsewhere is a copy', () => {
    expect(firstState(file(), card, 'draft_uploaded')).toBe('taken')
    expect(firstState(file({ id: 'other', md5: 'aaa', name: 'Grade/Pasta.mp4' }), card, 'colour_grade')).toBe('copy')
  })
  it('shoot footage and non-media are skipped', () => {
    expect(firstState(file({ id: 'x', md5: 'z', name: 'Raw footage/C0012.MP4' }), card, 'draft_uploaded')).toBe('footage')
    expect(firstState(file({ id: 'x', md5: 'z', name: 'Raw/clip.mp4' }), card, 'draft_uploaded')).toBe('footage')
    expect(firstState(file({ id: 'x', md5: 'z', name: 'IMG_0961.MOV' }), card, 'draft_uploaded')).toBe('footage')
    expect(firstState(file({ id: 'x', md5: 'z', name: 'project.prproj', mime: 'application/octet-stream' }), card, 'draft_uploaded')).toBe('footage')
  })
  it('at the quality check and with the client a new file waits; editing and colour grade take it', () => {
    const f = file({ id: 'new', md5: 'zzz', name: 'Reels/Dessert.mp4' })
    expect(firstState(f, card, 'quality_check')).toBe('locked')
    expect(firstState(f, card, 'client_review')).toBe('locked')
    expect(firstState(f, card, 'approved_for_scheduling')).toBe('locked')
    expect(firstState(f, card, 'draft_uploaded')).toBe('new')
    expect(firstState(f, card, 'revision_required')).toBe('new')
    expect(firstState(f, card, 'colour_grade')).toBe('new')
  })
  it('the stage says who it is for', () => {
    expect(stageRule('draft_uploaded').who).toBe('editor')
    expect(stageRule('colour_grade').who).toBe('colourist')
    expect(stageRule('quality_check')).toMatchObject({ who: 'nobody' })
  })
  it('names that only look like footage are not', () => {
    expect(isFootage({ name: 'Reels/Video 20.mp4' })).toBe(false)
    expect(isFootage({ name: 'Week 2/Pod 1.mp4' })).toBe(false)
  })
})

describe('the name without its version words', () => {
  it.each([
    ['Pasta v2.mp4', 'pasta'], ['Pasta_V03.mov', 'pasta'], ['Pasta FINAL.mp4', 'pasta'], ['Pasta (1).mp4', 'pasta'],
    ['Pasta copy.mp4', 'pasta'], ['Graded/Pasta_graded.mp4', 'pasta'], ['Pasta 21-10.mp4', 'pasta'], ['Pod 2.mp4', 'pod 2'],
  ])('%s → %s', (name, stem) => expect(nameStem(name)).toBe(stem))
})

describe('which video it may be', () => {
  it('ranks by name, then length', () => {
    const c = rankCandidates(file({ id: 'n', name: 'Graded/Pasta_graded.mp4', durationMs: 30_040 }), card)
    expect(c[0]).toMatchObject({ asset: 'A1' })
    expect(c[0].why).toEqual(expect.arrayContaining(['same name', 'same length']))
  })
  it('keeps "Pod 2" apart from "Pod 1"', () => {
    expect(rankCandidates(file({ id: 'n', name: 'Pod 1.mp4' }), card).find(c => c.asset === 'A2' && c.why.includes('same name'))).toBeUndefined()
  })
})

describe('graded = the same edit with its colour changed', () => {
  const cands = [{ asset: 'A1', name: 'Pasta.mp4', score: 8, why: [] }]
  const ai = (o: Partial<Parameters<typeof verdictOf>[0]> = {}) => ({ match: 'A1', same_edit: true, colour_changed: true, confidence: 0.9, reasons: [], ...o })
  it('at colour grade, by the colourist → graded, no question', () => {
    expect(verdictOf(ai(), { status: 'colour_grade', candidates: cands, byColourist: true, gradedFolder: false })).toMatchObject({ kind: 'graded', asset: 'A1', ask: false })
  })
  it('same edit, colour unchanged → a copy; at colour grade that is asked about', () => {
    expect(verdictOf(ai({ colour_changed: false }), { status: 'colour_grade', candidates: cands, byColourist: true, gradedFolder: false })).toMatchObject({ kind: 'copy', ask: true })
  })
  it('a different edit → a re-cut', () => {
    expect(verdictOf(ai({ same_edit: false }), { status: 'revision_required', candidates: cands, byColourist: false, gradedFolder: false })).toMatchObject({ kind: 'recut', ask: false })
  })
  it('looks graded but added by the editor while editing → asked, not filed', () => {
    expect(verdictOf(ai(), { status: 'draft_uploaded', candidates: cands, byColourist: false, gradedFolder: false }).ask).toBe(true)
  })
  it('no match, or a match not among the candidates → a new video', () => {
    expect(verdictOf(ai({ match: 'new' }), { status: 'draft_uploaded', candidates: cands, byColourist: false, gradedFolder: false })).toMatchObject({ kind: 'new_video', asset: null })
    expect(verdictOf(ai({ match: 'ZZ' }), { status: 'draft_uploaded', candidates: cands, byColourist: false, gradedFolder: false }).kind).toBe('new_video')
  })
  it('unsure → asked', () => {
    expect(verdictOf(ai({ confidence: 0.5 }), { status: 'colour_grade', candidates: cands, byColourist: true, gradedFolder: false }).ask).toBe(true)
  })
})

describe('the preview board', () => {
  it('lanes and steps follow the road', () => {
    expect(laneOf('revision_required')?.key).toBe('editing')
    expect(laneOf('colour_grade')?.key).toBe('grade')
    expect(laneOf('published')).toBeNull()
    expect(stepOf('client_review')).toBe(3)
  })
  it('a card face counts what the AI is doing', () => {
    const face = cardFace({ id: 'c', final_files: [] }, [
      { item_id: 'c', state: 'new' }, { item_id: 'c', state: 'scanning' }, { item_id: 'c', state: 'scanned' },
      { item_id: 'c', state: 'locked' }, { item_id: 'x', state: 'new' },
    ], [{ item_id: 'c' }])
    expect(face).toMatchObject({ scanning: 2, toConfirm: 1, waiting: 1, sources: 1, videos: 0 })
  })
})

describe('heldToMeasures', () => {
  const ai = { match: 'A1', same_edit: false, colour_changed: false, confidence: 0.6, reasons: ['shots look alike'] }
  const far = { lengthGapMs: 52_000, sound: 0.1, colourShift: 7, punchier: false }
  it('turns an unsure match the measures contradict into a new video', () => {
    expect(heldToMeasures(ai, far)).toMatchObject({ match: 'new', confidence: 0.6 })
  })
  it('keeps a sure match, a match with shared sound, and a near length', () => {
    expect(heldToMeasures({ ...ai, confidence: 0.9 }, far).match).toBe('A1')
    expect(heldToMeasures(ai, { ...far, sound: 0.6 }).match).toBe('A1')
    expect(heldToMeasures(ai, { ...far, lengthGapMs: 4000 }).match).toBe('A1')
  })
})

describe('cardLinksOf and camera originals', () => {
  it("watches every Drive link the card has — hand-ins, its own, raw footage, earlier versions — once each", () => {
    const links = cardLinksOf({
      link_url: 'https://drive.google.com/drive/folders/WORK',
      raw_assets_url: 'https://drive.google.com/drive/folders/RAW',
      link_versions: [{ url: 'https://drive.google.com/file/d/V1/view' }, { url: 'https://vimeo.com/1' }, { url: 'https://drive.google.com/drive/folders/WORK' }],
    }, [{ link: 'https://drive.google.com/drive/folders/HANDIN', by: 'u1' }])
    expect(links.map(l => l.link)).toEqual([
      'https://drive.google.com/drive/folders/HANDIN', 'https://drive.google.com/drive/folders/WORK', 'https://drive.google.com/drive/folders/RAW', 'https://drive.google.com/file/d/V1/view',
    ])
  })
  it('skips MXF and other camera originals as footage', () => {
    expect(isFootage({ name: 'MXF/Script 1.mxf' })).toBe(true)
    expect(isFootage({ name: 'Script 2.mxf' })).toBe(true)
    expect(isFootage({ name: 'New Menu Medley_v2.mov' })).toBe(false)
  })
})
