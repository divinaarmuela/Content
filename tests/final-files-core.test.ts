import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { finalFilesAsPulls, finalFilesForRound, finalFilesOf, handsInFiles, hasFinishedWork, sanitiseFinalFiles, withFinalFiles, withoutFinalFile } from '../app/lib/final-files-core'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

describe('finished work handed in as files (17 Sep 2026)', () => {
  const a = { id: 'f1', name: 'hero.png', url: 'https://files.test/hero.png', mime: 'image/png', size: 10, version: 1, uploaded_at: '2026-09-17T00:00:00.000Z' }
  it('reads only well-formed files, and a file with no round is round 1', () => {
    expect(finalFilesOf({ final_files: [a, { id: 'x' }, null, { ...a, id: 'f2', url: 'http://not-https' }, { ...a, id: 'f3', url: 'https://files.test/b.png', version: undefined }] }).map(f => [f.id, f.version])).toEqual([['f1', 1], ['f3', 1]])
    expect(finalFilesOf({})).toEqual([])
  })
  it('the hand-in is the files for the round the card is on — last round’s files do not count after a send-back', () => {
    const card = { status: 'draft_uploaded', final_files: [a] }
    expect(hasFinishedWork(card)).toBe(true)
    expect(hasFinishedWork({ status: 'revision_required', edit_round: 1, final_files: [a] })).toBe(false)
    expect(hasFinishedWork({ status: 'revision_required', edit_round: 1, final_files: [a, { ...a, id: 'f2', url: 'https://files.test/v2.png', version: 2 }] })).toBe(true)
    expect(hasFinishedWork({ status: 'draft_uploaded', link_url: 'https://drive.google.com/drive/folders/E', link_kind: 'drive', link_final: true })).toBe(true)
    expect(hasFinishedWork({ status: 'draft_uploaded' })).toBe(false)
    expect(finalFilesForRound({ final_files: [a, { ...a, id: 'f2', version: 2 }] }, 2).map(f => f.id)).toEqual(['f2'])
  })
  it('adds files for a round without doubling one already there, takes one off, and hands them to the tiles as copies', () => {
    const next = withFinalFiles([a], [{ name: 'hero.png', url: 'https://files.test/hero.png', mime: 'image/png', size: 10 }, { name: 'b.png', url: 'https://files.test/b.png', mime: 'image/png', size: 5 }], 2, 'u1', '2026-09-17T01:00:00.000Z')
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ name: 'b.png', version: 2, by: 'u1' })
    expect(withoutFinalFile(next, next[1].id)).toEqual([a])
    expect(finalFilesAsPulls({ final_files: [a] })[0]).toMatchObject({ id: 'f1', status: 'done', url: a.url, version: 1 })
  })
  it('a PATCH’s files are cleaned: https only, no doubles, new ones stamped with the card’s round', () => {
    const r = sanitiseFinalFiles([{ url: 'https://files.test/new.png', name: 'new.png' }, { id: 'f1', url: 'https://files.test/hero.png', name: 'hero.png', version: 1 }, { url: 'https://files.test/hero.png' }], { status: 'revision_required', edit_round: 1 }, 'u1', '2026-09-17T02:00:00.000Z')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.files).toHaveLength(2)
      expect(r.files[0]).toMatchObject({ name: 'new.png', version: 2, by: 'u1', mime: 'image/*' })
      expect(r.files[1]).toMatchObject({ id: 'f1', version: 1 })
    }
    expect(sanitiseFinalFiles([{ url: 'ftp://x' }], {}, null, 'now')).toEqual({ ok: false, error: 'A finished file needs its https address' })
    expect(sanitiseFinalFiles('nope', {}, null, 'now')).toMatchObject({ ok: false })
    expect(handsInFiles({ work_kinds: { slug: 'graphics' } })).toBe(true)
    expect(handsInFiles({ work_kinds: { slug: 'edit' }, final_files: [a] })).toBe(true)
    expect(handsInFiles({ work_kinds: { slug: 'edit' } })).toBe(false)
  })
  it('every place that asks “is there a finished edit?” asks about files too', () => {
    expect(src('app/lib/board-view-core.ts')).toContain('!hasFinishedWork(card as never)')
    expect(src('app/lib/people-filter-core.ts')).toContain('return hasFinishedWork(c as never)')
    expect(src('app/lib/workflow.ts')).toContain('const hasFiles = finalFilesForRound(item as never, handInRound(item as never)).length > 0')
    expect(src('app/dashboard/board/EditorCardDrawer.tsx')).toContain("disabled={busy || !qcComplete(ticks) || !hasFinishedWork(item as never)}")
    expect(src('app/dashboard/board/FilesToWorkFrom.tsx')).toContain("purpose: 'finished', files: finalFilesAsPulls(item)")
    expect(src('app/lib/editing-portal.ts')).toContain('const uploaded = finalFilesOf(item)')
    expect(src('app/dashboard/designer/page.tsx')).toContain("(c.work_kinds?.slug ?? '') === 'graphics'")
  })
})

describe('the next step at the top of the card (17 Sep 2026)', () => {
  it('the drawer puts the hand-in, or the road to submit, under the title', () => {
    const s = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(s).toContain('data-next-step')
    expect(s).toContain('{holder && submitting && !frozen && !kindLoading && (')
    expect(s).toContain("{filesCard ? `Upload ${roundLabel(handInRound(item as never))}` : `Add the ${roundLabel(handInRound(item as never))} link`}")
    expect(s).toContain('is on the card — tick the checks and submit')
  })
})

describe('a designer’s second version passes the re-submit gate (17 Sep 2026)', () => {
  it('files handed in for the round opened by the send-back count as the new version', () => {
    const s = readFileSync('app/lib/workflow.ts', 'utf8')
    expect(s).toContain("if (!system && !isBriefTask && !hasLink && !hasFiles && from === 'revision_required' && (to === 'revision_complete' || to === 'quality_check')) {")
  })
})

describe('the list view counts files on the card (17 Sep 2026)', () => {
  it('a card of files reads "N files on the card", not "Nothing yet"', () => {
    const s = readFileSync('app/dashboard/board/BoardList.tsx', 'utf8')
    expect(s).toContain('const handedIn = hasFinishedWork(card as never)')
    expect(s).toContain("on the card` : 'Finished edit in') : lines.link ? 'Folder only' : 'Nothing yet'")
  })
})
