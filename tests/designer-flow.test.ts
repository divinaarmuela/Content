import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  currentFiles, finalFilesChangeRefusal, hasFinishedWork, liveFilesAt, stillToReplace, withFinalFiles, withReplacement,
  assetIdOf, type FinalFile,
} from '../app/lib/final-files-core'
import { handInRound, roundOf } from '../app/lib/edit-round-core'
import { clientSeenRound, clipsAtRound, withClientRound, pieceWords, pieceKindOf } from '../app/lib/editing-portal-core'
import { approvedFilesVersion } from '../app/lib/social-schedule-core'
import { approvedClipsWords } from '../app/lib/clip-approvals-core'
import { emptyProfile, isPictureFile, normaliseProfile, toScanShape } from '../app/lib/brand-profile-core'

/**
 * THE DESIGNER'S ROAD (the owner, 28 Sep 2026: "while we fixed the editors page, did we fix the designer page flow —
 * I don't think so"). A graphics card is the editor's card with pictures: the same functions carry it. This walks an
 * eight-slide carousel the whole way and checks the places that were a designer's own.
 */
type Card = {
  status: string; edit_round?: number; client_round?: number; client_rounds?: number[]
  final_files: FinalFile[]; change_assets?: string[]; change_note_at?: string; scheduler_ids?: string[]
}
const url = (n: string) => `https://media.mdmmarketing.com.au/${n}`
const png = (name: string) => ({ name, url: url(name), mime: 'image/png', size: 1000 })
const at = (m: number) => new Date(Date.UTC(2026, 8, 28, 1, m)).toISOString()

describe('an eight-slide carousel, from first design to the scheduler', () => {
  const card: Card = { status: 'draft_uploaded', final_files: [] }
  let slide3 = ''

  it('the designer uploads 8 slides as Version 1', () => {
    card.final_files = withFinalFiles([], Array.from({ length: 8 }, (_, i) => png(`${i + 1}.png`)), 1, 'designer', at(0))
    slide3 = assetIdOf(card.final_files[2])
    expect(currentFiles(card as never)).toHaveLength(8)
    expect(hasFinishedWork(card as never)).toBe(true)
  })

  it('the client sees "8 designs", not "8 clips"', () => {
    card.status = 'client_review'; card.client_round = 1; card.client_rounds = withClientRound(undefined, 1)
    const live = liveFilesAt(card as never, clientSeenRound(card as never))
    const w = pieceWords(live.map(f => pieceKindOf(f.mime, f.name)))
    expect(w).toEqual({ one: 'design', many: 'designs', see: 'See' })
    expect(approvedClipsWords(8, 8, w)).toBe('All 8 designs approved by the client')
    expect(approvedClipsWords(3, 8, w)).toBe('3 of 8 designs approved by the client')
  })

  it('the client asks for a change on slide 3 — Version 2 is that slide re-done, the rest carried', () => {
    card.status = 'client_changes_requested'; card.change_assets = [slide3]; card.change_note_at = at(5)
    expect(handInRound(card as never)).toBe(2)
    expect(stillToReplace(card as never)).toEqual([slide3])
    expect(hasFinishedWork(card as never)).toBe(false)
    card.final_files = withReplacement(card.final_files, slide3, png('3-v2.png'), 2, 'designer', at(6))
    card.edit_round = 2
    expect(stillToReplace(card as never)).toEqual([])
    expect(hasFinishedWork(card as never)).toBe(true)
  })

  it('back with the client: Version 2 has the new slide 3, Version 1 still shows the old one', () => {
    card.status = 'client_review'; card.client_round = 2; card.client_rounds = withClientRound(card.client_rounds, 2)
    const clips = card.final_files.map(f => ({ id: f.id, name: f.name, version: f.version, asset_id: assetIdOf(f), carries: true, retired_round: null }))
    expect(clipsAtRound(clips, 2).map(c => c.name)).toContain('3-v2.png')
    expect(clipsAtRound(clips, 1).map(c => c.name)).toContain('3.png')
  })

  it('approved and handed to the scheduler: they get exactly the 8 approved slides, locked', () => {
    card.status = 'approved_for_scheduling'
    const v = approvedFilesVersion(card as never)!
    expect((v.files as { name: string }[]).map(f => f.name)).toEqual(['1.png', '2.png', '3-v2.png', '4.png', '5.png', '6.png', '7.png', '8.png'])
    const late = withReplacement(card.final_files, slide3, png('3-late.png'), 2, 'designer', at(9))
    expect(finalFilesChangeRefusal(card.final_files, late, card as never, true)).toMatch(/approved/)
    card.status = 'draft_uploaded'; card.scheduler_ids = ['cath']
    expect((approvedFilesVersion(card as never)!.files as unknown[]).length).toBe(8)
    expect(roundOf(card as never)).toBe(2)
  })
})

describe('what to call the pieces', () => {
  it('clips stay clips, a mix is files', () => {
    expect(pieceWords(['video', 'video']).many).toBe('clips')
    expect(pieceWords([]).many).toBe('clips')
    expect(pieceWords(['image', 'video']).many).toBe('files')
    expect(pieceKindOf('', 'Slide 1.JPG')).toBe('image')
    expect(pieceKindOf('video/mp4', 'x')).toBe('video')
    expect(approvedClipsWords(2, 2)).toBe('All 2 clips approved by the client')
  })
})

describe('a designer\'s card opens on the Designer board', () => {
  it('the shared card page moves a graphics card from the Editor address to the Designer one', () => {
    const src = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(src).toContain('router.replace(`/dashboard/designer/${id}`)')
  })
})

describe('logos and brand files reach every card (Karly, 28 Sep 2026)', () => {
  it('the card\'s Brand tab is given the logo files', () => {
    const p = normaliseProfile({ ...emptyProfile(), logo_files: [{ name: 'MGMT logo.svg', url: url('mgmt.svg') }, { name: 'Brand kit.zip', url: url('kit.zip') }] })
    expect(toScanShape(p).logo_files).toEqual([{ name: 'MGMT logo.svg', url: url('mgmt.svg') }, { name: 'Brand kit.zip', url: url('kit.zip') }])
    expect(toScanShape(normaliseProfile(emptyProfile())).logo_files).toBeUndefined()
  })
  it('pictures show as pictures, the rest as their type', () => {
    expect(isPictureFile({ name: 'logo.SVG' })).toBe(true)
    expect(isPictureFile({ name: 'x', url: url('a.png?v=2') })).toBe(true)
    expect(isPictureFile({ name: 'kit.zip', url: url('kit.zip') })).toBe(false)
  })
  it('the Brand tab uploads files (account managers up) and the card shows them', () => {
    const route = readFileSync('app/api/clients/[id]/brand/route.ts', 'utf8')
    expect(route).toContain("body?.action === 'sign_asset'")
    expect(route.indexOf("requireRole('account_manager')")).toBeLessThan(route.indexOf("'sign_asset'"))
    expect(readFileSync('app/dashboard/clients/[id]/BrandPanel.tsx', 'utf8')).toContain("action: 'sign_asset'")
    expect(readFileSync('app/dashboard/production/BrandCard.tsx', 'utf8')).toContain('profile.logo_files!.map')
  })
})
