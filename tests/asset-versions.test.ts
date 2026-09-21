import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { assetHistory, assetIdOf, changeAssetsOf, currentFiles, hasFinishedWork, mayReplaceAsset, sanitiseChangeAssets, stillToReplace, withReplacement, type FinalFile } from '../app/lib/final-files-core'

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
    expect(drawer).toContain('mayReplaceAsset(item as never, a) && !okByClient && (')
  })
})
