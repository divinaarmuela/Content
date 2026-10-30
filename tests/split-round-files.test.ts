import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { carriedClipNotes, roundCardFiles } from '../app/lib/split-core'
import { mayReplaceAsset, stillToReplace } from '../app/lib/final-files-core'
import { handInRound } from '../app/lib/edit-round-core'

// 30 Oct 2026, the owner, on Jordan Wilson's "October Videos · Round 2" (Video 03 and 04 sent back, the card empty):
// "how would they know which videos to replace the versions"

describe('the unapproved videos are the Round N card’s own files', () => {
  const originals = [
    { id: 'v3', name: 'Video 03.mp4', url: 'https://r2/v3', mime: 'video/mp4', size: 100, version: 1, uploaded_at: '2026-10-25T07:16:48Z', by: 'ed' },
    { id: 'v4', name: 'Video 04.mp4', url: 'https://r2/v4', mime: 'video/quicktime', size: 200, version: 1, uploaded_at: '2026-10-25T07:17:16Z', by: 'ed' },
  ]
  const open = [
    { id: 'v3', asset_id: 'v3', name: 'Video 03.mp4', url: 'https://r2/v3' },
    { id: 'v4', asset_id: 'v4', name: 'Video 04.mp4', url: 'https://r2/v4' },
  ]
  let n = 0
  const made = roundCardFiles(open, originals, '2026-10-29T05:29:05Z', 'client', () => `new${++n}`)

  it('each is a piece of its own at Version 1, the cut the client turned down', () => {
    expect(made.files.map(f => [f.id, f.asset_id, f.name, f.version, f.mime, f.size])).toEqual([
      ['new1', 'new1', 'Video 03.mp4', 1, 'video/mp4', 100],
      ['new2', 'new2', 'Video 04.mp4', 1, 'video/quicktime', 200],
    ])
    expect(made.byOld.get('v3')).toBe('new1')
  })

  it('the card opens sent back on them: Version 2 is next, each has "+ New version", and it waits for both', () => {
    const card = { status: 'revision_required', final_files: made.files, edit_round: 1, client_rounds: [1], change_assets: made.files.map(f => f.id), change_note_at: '2026-10-29T05:29:05Z' }
    expect(handInRound(card)).toBe(2)
    expect(mayReplaceAsset(card, 'new1')).toBe(true)
    expect(stillToReplace(card)).toEqual(['new1', 'new2'])
  })

  it('what the client said on a video lands on that video; the team’s own notes do not', () => {
    expect(carriedClipNotes(made.byOld, [
      { video_file_id: 'v3', visibility: 'client', body: 'Not getting to the point' },
      { video_file_id: 'v3', visibility: 'internal', body: 'team only' },
      { video_file_id: 'v1', visibility: 'client', body: 'approved one' },
    ])).toEqual([{ file_id: 'new1', body: 'The client: Not getting to the point' }])
  })

  it('the split writes it so, and tells the editor in those words', () => {
    const src = readFileSync('app/lib/split.ts', 'utf8')
    expect(src).toContain("status: 'revision_required',")
    expect(src).toContain('change_assets: onCard.files.map(f => f.id),')
    expect(src).toContain('const subject = `New versions to make: ${title}`')
  })
})
