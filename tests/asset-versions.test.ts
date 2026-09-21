import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isRetiredAt, liveFilesAt, withRetired, adoptedFromPull, needsAdoption, assetHistory, assetIdOf, changeAssetsOf, currentFiles, hasFinishedWork, mayReplaceAsset, sanitiseChangeAssets, stillToReplace, withReplacement, type FinalFile } from '../app/lib/final-files-core'

const f = (id: string, version = 1, extra: Partial<FinalFile> = {}): FinalFile => ({ id, name: `${id}.mp4`, url: `https://cdn.x/${id}-${version}.mp4`, mime: 'video/mp4', size: 10, version, uploaded_at: `2026-09-2${version}T00:00:00Z`, by: 'u', ...extra })
const three = [f('a'), f('b'), f('c')]

describe('one asset, its versions (22 Sep 2026): "2 get approved, 1 needs changing, so 1 gets sent back"', () => {
  it('a replacement takes the asset’s slot as the next version; the others are untouched', () => {
    const next = withReplacement(three, 'c', { name: 'c-fixed.mp4', url: 'https://cdn.x/c2.mp4', mime: 'video/mp4', size: 12 }, 2, 'u', '2026-09-22T00:00:00Z')
    expect(next).toHaveLength(4)
    const v2 = next[3]
    expect(v2).toMatchObject({ asset_id: 'c', replaces: 'c', version: 2, name: 'c-fixed.mp4' })
    expect(currentFiles({ final_files: next }).map(x => [assetIdOf(x), x.version])).toEqual([['a', 1], ['b', 1], ['c', 2]])
    expect(assetHistory({ final_files: next }, 'c').map(x => x.version)).toEqual([1, 2])
    // the wrong export, then the right one, in the same round: swapped, not stacked
    const again = withReplacement(next, 'c', { name: 'c-right.mp4', url: 'https://cdn.x/c2b.mp4', mime: 'video/mp4', size: 13 }, 2, 'u', '2026-09-22T01:00:00Z')
    expect(again).toHaveLength(4)
    expect(again[3]).toMatchObject({ asset_id: 'c', replaces: 'c', version: 2, name: 'c-right.mp4' })
  })

  it('a sent-back card is handed in when every NAMED asset has its new version — and only then', () => {
    const back = { final_files: three, change_assets: ['c'], edit_round: 1, status: 'revision_required' }
    expect(changeAssetsOf(back)).toEqual(['c'])
    expect(stillToReplace(back)).toEqual(['c'])
    expect(hasFinishedWork(back)).toBe(false)
    expect(mayReplaceAsset(back, 'c')).toBe(true)
    expect(mayReplaceAsset(back, 'a')).toBe(false)                       // not named: it stays as it is
    const done = { ...back, final_files: withReplacement(three, 'c', { name: 'c2.mp4', url: 'https://cdn.x/c2.mp4', mime: 'video/mp4', size: 1 }, 2, 'u', 'now') }
    expect(stillToReplace(done)).toEqual([])
    expect(hasFinishedWork(done)).toBe(true)
    // nothing named = the whole card: any asset may be replaced, and one new file is a hand-in
    const whole = { final_files: three, change_assets: [], edit_round: 1, status: 'revision_required' }
    expect(mayReplaceAsset(whole, 'a')).toBe(true)
    expect(hasFinishedWork(whole)).toBe(false)
    // not sent back: nothing is replaced
    expect(mayReplaceAsset({ final_files: three, edit_round: 1, status: 'quality_check' }, 'a')).toBe(false)
    // a send-back may only name assets that are on the card, each once
    expect(sanitiseChangeAssets(['c', 'c', 'zz', 7], { final_files: three })).toEqual(['c'])
  })

  it('the send-back names the assets and writes each one’s words on that asset; the editor’s card replaces in place', () => {
    const route = readFileSync('app/api/production/items/[id]/send-back/route.ts', 'utf8')
    expect(route).toContain('change_assets: named,')
    expect(route).toContain('video_file_id: a.file.id, video_file_name: a.file.name,')
    const dialog = readFileSync('app/dashboard/board/BoardDialogs.tsx', 'utf8')
    expect(dialog).toContain("body: JSON.stringify({ note, assets: named.map(a => ({ asset_id: a, note: picked[a] ?? '' })) }),")
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain('const next = withReplacement(finalFilesOf(item as never), assetId,')
    // an asset the client approved is not offered for replacing
    expect(drawer).toContain('mayReplaceAsset(item as never, a) && !okByClient && !dropped && (')
    // a super admin or account manager may upload and replace too, not only the holder (22 Sep 2026)
    expect(drawer).toContain("const mayFile = holder || me?.role === 'super_admin' || me?.role === 'account_manager'")
    expect(drawer).toContain('{mayFile && !frozen && mayReplaceAsset(item as never, a) && !okByClient && !dropped && (')
  })

  it('an existing link card’s copied clips become its assets, so one of them can be swapped (22 Sep 2026)', () => {
    const pulled = [{ id: '1abc', name: 'Glass Den 1.mov', mime: 'video/quicktime', size: 5, url: 'https://cdn.x/1abc.mov', status: 'done', version: 1 }, { id: '2def', name: 'half.mov', mime: 'video/quicktime', size: null, url: null, status: 'copying', version: 1 }]
    const files = adoptedFromPull(pulled, 'u', 'now')
    expect(files).toHaveLength(1)                                                       // a clip still copying is not adopted
    expect(files[0]).toMatchObject({ id: '1abc', asset_id: '1abc', version: 1, url: 'https://cdn.x/1abc.mov' })   // the Drive id stays: the comments hang off it
    expect(needsAdoption({ final_files: [], link_url: 'https://drive.google.com/drive/folders/abcdefghijk', link_kind: 'drive', link_final: true })).toBe(true)
    expect(needsAdoption({ final_files: files, link_url: 'https://drive.google.com/drive/folders/abcdefghijk', link_kind: 'drive', link_final: true })).toBe(false)
    // the send-back adopts before it names; the dialog and the editor's card adopt when they meet such a card; decided in a claim
    expect(readFileSync('app/api/production/items/[id]/send-back/route.ts', 'utf8')).toContain('const adopted = await adoptClips(loaded as never, user.id)')
    expect(readFileSync('app/lib/adopt-clips.ts', 'utf8')).toContain('if (!cur || finalFilesOf(cur as never).length > 0) return null')
    expect(readFileSync('app/dashboard/board/BoardDialogs.tsx', 'utf8')).toContain("/adopt-clips`, { method: 'POST' })")
  })

  it('a clip can be dropped from a version on: gone from Version 2, still in Version 1 with its comments, reversible until handed in (22 Sep 2026)', () => {
    const back = { final_files: three, change_assets: [], edit_round: 1, status: 'revision_required' }
    const dropped = withRetired(three, 'b', 2)
    expect(dropped.find(x => x.id === 'b')?.retired_round).toBe(2)
    expect(isRetiredAt(dropped[1], 2)).toBe(true)
    expect(isRetiredAt(dropped[1], 1)).toBe(false)
    expect(liveFilesAt({ final_files: dropped }, 2).map(assetIdOf)).toEqual(['a', 'c'])
    expect(liveFilesAt({ final_files: dropped }, 1).map(assetIdOf)).toEqual(['a', 'b', 'c'])
    // dropping one IS a change: the whole-card hand-in is met
    expect(hasFinishedWork({ ...back, final_files: dropped })).toBe(true)
    // a named asset that is dropped no longer waits for a replacement
    expect(stillToReplace({ ...back, change_assets: ['b'], final_files: dropped })).toEqual([])
    // a send-back cannot name what is already out
    expect(sanitiseChangeAssets(['b', 'c'], { final_files: dropped })).toEqual(['c'])
    // brought back: the mark is gone, nothing else changed
    const backAgain = withRetired(dropped, 'b', null)
    expect(backAgain.find(x => x.id === 'b')?.retired_round).toBeUndefined()
    expect(backAgain).toHaveLength(3)
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain('Drop from {roundLabel(handInRound(item as never))}')
    expect(drawer).toContain('>Bring back</Button>')
  })
})
