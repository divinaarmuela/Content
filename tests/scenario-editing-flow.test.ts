import { describe, expect, it } from 'vitest'
import {
  currentFiles, finalFilesChangeRefusal, liveFilesAt, mergeHandIn, stillToReplace, withFinalFiles, withReplacement, withRetired,
  assetIdOf, type FinalFile,
} from '../app/lib/final-files-core'
import { handInRound, roundOf } from '../app/lib/edit-round-core'
import { clientSeenRound, clipsAtRound, clientRoundsOf, withClientRound, asClientVersions } from '../app/lib/editing-portal-core'
import { approvedFilesVersion } from '../app/lib/social-schedule-core'
import { postedProgress } from '../app/lib/posted-slides-core'

/**
 * ONE CARD, THE WHOLE ROAD, THE HARD WAY (the owner, 25 Sep 2026: "test full flow, give a complicated scenario and
 * do it"). Three clips; the quality check sends one back before the client ever sees it; the client approves one,
 * asks for a change on another and the editor tries to sneak a third change in; the approved set is handed to a
 * scheduler and posted one clip at a time. At every step: what the editor, the quality check, the client and the
 * scheduler are shown — read through the same functions the pages use.
 */
type Card = {
  status: string; edit_round?: number; client_round?: number; client_rounds?: number[]
  final_files: FinalFile[]; change_assets?: string[]; change_note_at?: string; scheduler_ids?: string[]
}
const url = (n: string) => `https://media.mdmmarketing.com.au/${n}`
const up = (name: string) => ({ name, url: url(name), mime: 'video/mp4', size: 1000 })
const at = (m: number) => new Date(Date.UTC(2026, 8, 25, 1, m)).toISOString()
/** what the client portal shows at a version tab — the same selection editing-portal.ts makes */
const portal = (c: Card) => {
  const seen = clientSeenRound(c as never)
  const clips = c.final_files.filter(f => f.version <= seen)
    .map(f => ({ id: f.id, name: f.name, version: f.version, asset_id: assetIdOf(f), carries: true, retired_round: f.retired_round ?? null }))
  const rounds = clientRoundsOf(c as never)
  return { seen, rounds, at: (r: number) => clipsAtRound(clips, r).map(x => x.name), numbered: asClientVersions(clips, rounds) }
}

describe('a three-clip card, from first cut to posted', () => {
  const card: Card = { status: 'draft_uploaded', final_files: [] }
  let A = '', B = '', C = ''

  it('1. the editor hands in three clips as Version 1', () => {
    expect(handInRound(card as never)).toBe(1)
    card.final_files = withFinalFiles(card.final_files, [up('A.mp4'), up('B.mp4'), up('C.mp4')], 1, 'editor', at(0))
    ;[A, B, C] = card.final_files.map(assetIdOf)
    expect(currentFiles(card as never).map(f => f.name)).toEqual(['A.mp4', 'B.mp4', 'C.mp4'])
  })

  it('2. the quality check sends B back before the client sees anything — still Version 1', () => {
    card.status = 'revision_required'; card.change_assets = [B]; card.change_note_at = at(1)
    expect(handInRound(card as never)).toBe(1)
    expect(stillToReplace(card as never)).toEqual([B])
    // dropping B is NOT an answer to "change B"
    const dropped = withRetired(card.final_files, B, 1)
    expect(stillToReplace({ ...card, final_files: dropped } as never)).toEqual([B])
    card.final_files = withReplacement(card.final_files, B, up('B-fixed.mp4'), 1, 'editor', at(2))
    expect(stillToReplace(card as never)).toEqual([])
  })

  it('3. it goes to the client: Version 1 is A, the FIXED B and C — never the cut the quality check threw out', () => {
    card.status = 'client_review'; card.client_round = roundOf(card as never); card.client_rounds = withClientRound(card.client_rounds, roundOf(card as never))
    const p = portal(card)
    expect(p.seen).toBe(1)
    expect(p.at(1)).toEqual(['A.mp4', 'B-fixed.mp4', 'C.mp4'])
  })

  it('4. while the client looks, the editor may not change a file; a manager may', () => {
    const swapped = withReplacement(card.final_files, A, up('A-sneaky.mp4'), 1, 'editor', at(3))
    expect(finalFilesChangeRefusal(card.final_files, swapped, card as never, false)).toMatch(/only a manager/)
    expect(finalFilesChangeRefusal(card.final_files, swapped, card as never, true)).toBeNull()
  })

  it('5. the client asks for a change on C only; the next hand-in is Version 2', () => {
    card.status = 'revision_required'; card.change_assets = [C]; card.change_note_at = at(4)
    expect(handInRound(card as never)).toBe(2)
    expect(stillToReplace(card as never)).toEqual([C])
    // the editor may not rewrite or remove a Version 1 file
    const wiped = card.final_files.filter(f => assetIdOf(f) !== A)
    expect(finalFilesChangeRefusal(card.final_files, wiped, card as never, false)).toMatch(/earlier version/)
    card.final_files = withReplacement(card.final_files, C, up('C-v2.mp4'), 2, 'editor', at(5))
    card.edit_round = 2
    expect(stillToReplace(card as never)).toEqual([])
  })

  it('6. back to the client: Version 2 is A, fixed B, NEW C — and Version 1 still shows the old C', () => {
    card.status = 'client_review'; card.client_round = roundOf(card as never); card.client_rounds = withClientRound(card.client_rounds, roundOf(card as never))
    const p = portal(card)
    expect(p.rounds).toEqual([1, 2])
    expect(p.at(2)).toEqual(['A.mp4', 'B-fixed.mp4', 'C-v2.mp4'])
    expect(p.at(1)).toEqual(['A.mp4', 'B-fixed.mp4', 'C.mp4'])
  })

  it('7. approved: the approved set is exactly what the client saw at Version 2, and it is locked', () => {
    card.status = 'approved_for_scheduling'
    const v = approvedFilesVersion(card as never)!
    expect(v.version_number).toBe(2)
    expect((v.files as { name: string }[] ?? []).map(f => f.name)).toEqual(['A.mp4', 'B-fixed.mp4', 'C-v2.mp4'])
    const late = withReplacement(card.final_files, A, up('A-late.mp4'), 2, 'editor', at(6))
    expect(finalFilesChangeRefusal(card.final_files, late, card as never, true)).toMatch(/approved/)
  })

  it('8. handed to the scheduler (their Draft): they are offered the same three approved files', () => {
    card.status = 'draft_uploaded'; card.scheduler_ids = ['cath']
    expect((approvedFilesVersion(card as never)!.files as { name: string }[] ?? []).map(f => f.name)).toEqual(['A.mp4', 'B-fixed.mp4', 'C-v2.mp4'])
    expect(liveFilesAt(card as never, roundOf(card as never)).length).toBe(3)
  })

  it('9. posted one clip at a time: after A the card is 1 of 3, not "posted"', () => {
    const files = (approvedFilesVersion(card as never)!.files ?? []) as { url: string; name: string }[]
    const one = postedProgress(files, new Set([url('A.mp4')]))
    expect([one.posted, one.total]).toEqual([1, 3])
    const all = postedProgress(files, new Set(files.map(f => f.url)))
    expect([all.posted, all.total]).toEqual([3, 3])
  })
})

describe('the Drive hand-ins that went wrong on 24 Sep 2026', () => {
  it('a later hand-in re-using a clip name becomes that clip\'s next version, an unchanged file is carried', () => {
    let files = withFinalFiles([], [up('Script 5.mp4')], 1, 'e', at(0))
    const merged = mergeHandIn(files, [
      { id: files[0].id, name: 'Script 5.mp4', url: files[0].url, status: 'done' },
      { id: 'drive-new-1', name: 'Script 1.mp4', url: url('s1.mp4'), status: 'done' },
    ], 2, 'e', at(1))
    expect(merged.added).toBe(1)
    files = mergeHandIn(merged.files, [{ id: 'drive-new-5', name: 'Script 5.mp4', url: url('s5v2.mp4'), status: 'done' }], 2, 'e', at(2)).files
    const s5 = currentFiles({ final_files: files }).find(f => f.name === 'Script 5.mp4')!
    expect(s5.version).toBe(2)
    expect(s5.url).toBe(url('s5v2.mp4'))
  })
})
