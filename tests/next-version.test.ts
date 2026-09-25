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
  it('is allowed once this version has actually been handed in', () => {
    expect(mayStartNextRound({ status: 'in_progress', handedIn: true })).toBe(true)
    expect(mayStartNextRound({ status: 'quality_check', handedIn: true })).toBe(true)
    expect(mayStartNextRound({ status: 'in_progress', handedIn: false })).toBe(false)
  })

  it('is refused once the files belong to the channel', () => {
    expect(mayStartNextRound({ status: 'scheduled', handedIn: true })).toBe(false)
    expect(mayStartNextRound({ status: 'published', handedIn: true })).toBe(false)
  })

  it('says what it will do, and why it is off when it is', () => {
    expect(nextRoundWords({ status: 'in_progress', handedIn: true, round: 1 }))
      .toEqual({ label: 'Start Version 2', why: null })
    expect(nextRoundWords({ status: 'in_progress', handedIn: false, round: 1 }).why)
      .toBe('Nothing handed in for Version 1 yet — replace those files instead.')
    expect(nextRoundWords({ status: 'published', handedIn: true, round: 3 }))
      .toMatchObject({ label: 'Start Version 4' })
    expect(nextRoundWords({ status: 'scheduled', handedIn: true, round: 2 }).why)
      .toContain('the channel’s now')
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
    expect(route).toContain('if (!cur || roundOf(cur as never) !== round - 1) return null')
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
