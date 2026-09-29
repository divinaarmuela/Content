import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { handInRound, mayStartNextRound, nextRoundWords, roundLabel, roundOf } from '../app/lib/edit-round-core'

/**
 * AN EDITOR STARTS THE NEXT VERSION (the owner, 24 Sep 2026: "they just wanna
 * upload version 2 with the new files"; Yusuf: "how can I upload the 2 version
 * for these video as i am uploading it is still showing version 1").
 *
 * A round used to move only when a card came back for changes and was handed
 * in again, so an editor who re-exported had nowhere to put the new cut.
 */
describe('starting the next version', () => {
  const card = (status: string, extra: object = {}) => ({ status, edit_round: 1, ...extra })
  it('is allowed while the editor holds the card and this version has been handed in', () => {
    expect(mayStartNextRound({ item: card('draft_uploaded'), handedIn: true })).toBe(true)
    expect(mayStartNextRound({ item: card('revision_required'), handedIn: true })).toBe(true)
    expect(mayStartNextRound({ item: card('draft_uploaded'), handedIn: false })).toBe(false)
  })

  it("is refused once the round is handed over (29 Sep 2026: Real Deal's September 18th showed Version 2 in the quality check with Version 1's files)", () => {
    for (const s of ['quality_check', 'internal_review', 'revision_complete', 'client_review', 'approved_for_scheduling', 'scheduled', 'published']) {
      expect(mayStartNextRound({ item: card(s), handedIn: true }), s).toBe(false)
    }
  })

  it('is refused where the round moves by itself, so a card back from the client never skips a version', () => {
    const back = card('client_changes_requested', { client_rounds: [1] })
    expect(handInRound(back)).toBe(2)
    expect(mayStartNextRound({ item: back, handedIn: true })).toBe(false)
    expect(nextRoundWords({ item: back, handedIn: true }).why).toBe('Back from the client — what you hand in now is Version 2 by itself.')
    // the quality check sent back what the client had seen: the same, by itself
    expect(mayStartNextRound({ item: card('revision_required', { client_rounds: [1] }), handedIn: true })).toBe(false)
  })

  it('says what it will do, and why it is off when it is', () => {
    expect(nextRoundWords({ item: card('draft_uploaded'), handedIn: true })).toEqual({ label: 'Start Version 2', why: null })
    expect(nextRoundWords({ item: card('draft_uploaded'), handedIn: false }).why)
      .toBe('Nothing handed in for Version 1 yet — replace those files instead.')
    expect(nextRoundWords({ item: card('quality_check'), handedIn: true }).why)
      .toBe('Version 1 is handed over — it can only move once the card is back with you.')
    expect(nextRoundWords({ item: card('scheduled', { edit_round: 2 }), handedIn: true }))
      .toMatchObject({ label: 'Start Version 3', why: 'Booked in or already posted — the files are the channel’s now.' })
  })

  it('leaves the old rule alone: a card sent back still opens the next round by itself', () => {
    const sentBack = { status: 'revision_required', edit_round: 1, client_round: 1 }
    expect(handInRound(sentBack)).toBe(2)
    expect(roundOf({ edit_round: 1 })).toBe(1)
    expect(roundLabel(2)).toBe('Version 2')
    // and an in-progress card that nobody has reviewed stays where it is until the press
    expect(handInRound({ status: 'in_progress', edit_round: 1 })).toBe(1)
  })

  it('the route moves the round by one, claimed so two presses cannot both move it', () => {
    const route = readFileSync('app/api/production/items/[id]/next-version/route.ts', 'utf8')
    expect(route).toContain("const user = await requireRole('editor')")
    expect(route).toContain('if (!canEditItemFields(user, item)) {')
    expect(route).toContain('if (!cur || roundOf(cur as never) !== round - 1 || nextRoundWords({ item: cur as never, handedIn }).why) return null')
    // and who pressed it is on the card's history
    expect(route).toContain("action: 'version_started'")
    expect(route).toContain('return { ...cur, edit_round: round, updated_at: new Date().toISOString() }')
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain('/next-version`, { method: \'POST\' })')
    expect(drawer).toContain('{nextRound.label}')
  })
})

describe('a card handed in by a link can hand in files instead (the owner, 24 Sep 2026)', () => {
  it('offers the upload where before there was only the Drive box', () => {
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    // Yusuf's card: sent back by the quality check, a finished link on it, so `handsInFiles` was false and the
    // whole files half of the drawer was hidden — no upload button anywhere on it
    expect(drawer).toContain('{!linkMode ? (')
    expect(drawer).toContain('Upload the files here instead')
    expect(drawer).toContain('onClick={() => { setFileMode(true); setUploadOpen(true) }}')
  })

  it('and the version it lands on is still the one the rule says', async () => {
    const { handsInFiles } = await import('../app/lib/final-files-core')
    // the card as the database held it on 24 Sep: revision_required, a link, no files, no round yet
    const card = { status: 'revision_required', link_url: 'https://drive.google.com/drive/folders/x', link_final: true, final_files: [], work_kinds: null }
    expect(handInRound(card)).toBe(1)
    expect(handsInFiles(card as never)).toBe(false)
  })
})

describe('a started version is on the card history (29 Sep 2026)', () => {
  it('says who started which version', async () => {
    const { describeCardActivity } = await import('../app/lib/card-history-core')
    const line = describeCardActivity({ action: 'version_started', new_value: 'v2', actor: { name: 'Team AA Edits' } } as never)
    expect(line?.text).toMatch(/^Version 2 started by /)
  })
})
