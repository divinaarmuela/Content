import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SENT_BACK_STATUSES, fileRound, handInRound, nextRound, roundLabel, roundOf, roundsOf } from '../app/lib/edit-round-core'

/**
 * VERSION 1, VERSION 2, VERSION 3 (the owner, 16 Sep 2026: "version 1 is
 * the first time they send the finished Drive link, which triggers the
 * download; sent back to the editor, they make changes and send another
 * link — that's version 2").
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

describe('rounds (pure)', () => {
  it('a card starts at round 1; the hand-in after a send-back is the next; the words', () => {
    expect(handInRound({})).toBe(1)
    expect(handInRound({ status: 'draft_uploaded' })).toBe(1)
    expect(handInRound({ status: 'revision_required' })).toBe(2)
    expect(handInRound({ status: 'client_changes_requested', edit_round: 2 })).toBe(3)
    expect(handInRound({ status: 'quality_check', edit_round: 2 })).toBe(2)
    expect(roundOf(null)).toBe(1)
    expect(roundOf({})).toBe(1)
    expect(roundOf({ edit_round: 3 })).toBe(3)
    expect(roundOf({ edit_round: '2' })).toBe(2)
    expect(roundOf({ edit_round: 0 })).toBe(1)
    expect(nextRound({})).toBe(2)
    expect(nextRound({ edit_round: 2 })).toBe(3)
    expect(roundLabel(2)).toBe('Version 2')
    expect(SENT_BACK_STATUSES).toEqual(['revision_required', 'client_changes_requested'])
  })
  it('the rounds a set of files spans, newest first; a file with no round is round 1', () => {
    expect(roundsOf([{ version: 1 }, { version: 2 }, {}, { version: 2 }])).toEqual([2, 1])
    expect(roundsOf([])).toEqual([])
    expect(fileRound({})).toBe(1)
    expect(fileRound({ version: 3 })).toBe(3)
  })
})

describe('where rounds are opened, tagged and shown (source pins)', () => {
  it('a send-back does not bump the round — the next hand-in does, in the transition and in the link save', () => {
    expect(src('app/lib/workflow.ts')).not.toContain('edit_round')
    const t = src('app/api/production/items/[id]/transition/route.ts')
    expect(t).toContain('const round = handInRound(item)')
    expect(t).toContain("await table('content_items').update(id, { edit_round: round })")
  })
  it('every pull is tagged with the card’s round; the same link handed in again, and revisions done, pull again', () => {
    expect(src('app/api/drive/pull/route.ts')).toContain("version: finished ? roundOf(item) : 1, by: user.id, purpose: finished ? 'finished' : 'folder'")
    // a folder to work from is never a version
    expect(src('app/api/production/items/[id]/route.ts')).toContain('version: 1, by: user.id')
    const link = src('app/api/production/items/[id]/link/route.ts')
    expect(link).toContain("if (check.kind === 'drive' && final) startPullSoon({ kind: 'item', scopeId: id, folderUrl: check.url, version: handInRound(item), by: user.id, purpose: 'finished' })")
    expect(link).toContain("version: final ? handInRound(item) : 1, by: user.id, purpose: final ? 'finished' : 'folder'")
    const t = src('app/api/production/items/[id]/transition/route.ts')
    expect(t).toContain("if (SENT_BACK_STATUSES.includes(String(item.status)) && to === 'quality_check') {")
    expect(t).toContain("if (finished) startPullSoon({ kind: 'item', scopeId: id, folderUrl: finished.url, version: round, by: user.id, purpose: 'finished' })")
    // a file already here keeps the round it arrived with; a new file gets the current one
    const p = src('app/lib/drive-pull.ts')
    expect(p).toContain('const same = !!latest && latest.size === f.size && (!f.modified || !latest.modified || latest.modified === f.modified)')
    expect(p).toContain("parts: [], version: round, modified: f.modified })")
  })
  it('the card page has a tab per finished edit handed in, beside the folder to work from — the newest open (16 Sep 2026)', async () => {
    const { finishedVersionsOf } = await import('../app/lib/edit-round-core')
    const filesOf = (r: { files?: unknown }) => (Array.isArray(r.files) ? r.files : []) as { id: string; version?: number | null }[]
    const rows = [
      // the folder to work from is never a version
      { kind: 'item', scope_id: 'c1', folder_id: 'SRC', folder_url: 'https://drive.google.com/drive/folders/SRC', status: 'done', purpose: 'folder', files: [{ id: 's1', version: 1 }], started_at: '2026-09-10' },
      // version 1, one link; version 2 handed in from a different link
      { kind: 'item', scope_id: 'c1', folder_id: 'V1', folder_url: 'https://drive.google.com/drive/folders/V1', status: 'done', purpose: 'finished', files: [{ id: 'a', version: 1 }, { id: 'b', version: 1 }], started_at: '2026-09-11' },
      { kind: 'item', scope_id: 'c1', folder_id: 'V2', folder_url: 'https://drive.google.com/drive/folders/V2', status: 'copying', purpose: 'finished', files: [{ id: 'c', version: 2 }], started_at: '2026-09-12' },
      // somebody else's card
      { kind: 'item', scope_id: 'c2', folder_id: 'X', folder_url: 'https://drive.google.com/drive/folders/X', status: 'done', purpose: 'finished', files: [{ id: 'x', version: 1 }], started_at: '2026-09-12' },
    ]
    const tabs = finishedVersionsOf(rows, { itemId: 'c1', finishedFolderId: 'V2', filesOf })
    expect(tabs.map(t => [t.round, t.folderUrl, t.files.map(f => f.id), t.inFlight])).toEqual([
      [2, 'https://drive.google.com/drive/folders/V2', ['c'], true],
      [1, 'https://drive.google.com/drive/folders/V1', ['a', 'b'], false],
    ])
    // the folder to work from counts when that same link is the finished edit today (Yusuf's card, 16 Sep 2026)
    const sameLink = [{ kind: 'item', scope_id: 'c1', folder_id: 'SRC', folder_url: 'https://drive.google.com/file/d/SRC/view', status: 'done', purpose: 'folder', files: [{ id: 's1', version: 1 }], started_at: '2026-09-10' }]
    expect(finishedVersionsOf(sameLink, { itemId: 'c1', finishedFolderId: 'SRC', filesOf }).map(t => t.round)).toEqual([1])
    expect(src('app/lib/drive-pull.ts')).toContain("if (opts.purpose === 'finished' && (claim.current as { purpose?: string | null } | null)?.purpose !== 'finished') {")
    // an older row that never said what it was counts only when it is the card’s finished link today
    const old = [{ kind: 'item', scope_id: 'c1', folder_id: 'OLD', folder_url: 'https://drive.google.com/drive/folders/OLD', status: 'done', files: [{ id: 'o', version: 1 }], started_at: '2026-09-09' }]
    expect(finishedVersionsOf(old, { itemId: 'c1', finishedFolderId: 'OLD', filesOf })).toHaveLength(1)
    expect(finishedVersionsOf(old, { itemId: 'c1', finishedFolderId: 'ELSE', filesOf })).toEqual([])
    // a link still being read has its tab, empty, as the next round
    const reading = [...rows, { kind: 'item', scope_id: 'c1', folder_id: 'V3', folder_url: 'https://drive.google.com/drive/folders/V3', status: 'listing', purpose: 'finished', files: [], started_at: '2026-09-13' }]
    expect(finishedVersionsOf(reading, { itemId: 'c1', finishedFolderId: 'V3', filesOf }).map(t => [t.round, t.inFlight])).toEqual([[3, true], [2, true], [1, false]])
    const box = src('app/dashboard/board/FilesToWorkFrom.tsx')
    expect(box).toContain("const { rows: pullRows } = useTable<DrivePull>('drive_pulls', { by: { scope_id: item.id } as never, enabled: versions })")
    expect(box).toContain("const shownVersion = tab === 'folder' ? null : (tab === null ? versionTabs[0] : versionTabs.find(v => v.round === tab)) ?? null")
    expect(box).toContain('Folder to work from')
    expect(box).toContain("{roundLabel(v.round)}{v === versionTabs[0] ? ' · latest' : ''}{v.inFlight ? ' · copying in' : ''}")
    expect(box).toContain('<DriveFolderFiles url={shownVersion.folderUrl} wide={wideFiles} reviewHref={reviewHref} approvedIds={approvedIds} copies={shownVersion.files} selected={selecting ? pickedKeys : undefined} onSelect={selecting ? pick : undefined} />')
    expect(src('app/dashboard/editor/[id]/page.tsx')).toContain('fallbackFolder={from.footage} wideFiles versions')
    // every pull says what it was: the row's purpose
    expect(src('app/lib/drive-pull.ts')).toContain("purpose: opts.purpose ?? (row as { purpose?: string | null } | null)?.purpose ?? null,")
    expect(src('app/api/production/batches/[id]/route.ts')).toContain("by: user.id, purpose: 'folder' })")
    expect(src('app/api/production/items/[id]/route.ts')).toContain("version: 1, by: user.id, purpose: 'folder' })")
  })
  it('the board card and the detail page say the hand-in round, never the count of link saves (16 Sep 2026)', () => {
    expect(src('app/lib/board-view-core.ts')).toContain('version: versionWord(roundOf(card)),')
    expect(src('app/lib/board-view-core.ts')).not.toContain('versionWord(card.current_version_number)')
    const d = src('app/dashboard/production/[id]/CardDetail.tsx')
    expect(d).not.toContain('versionWord(detail.current_version_number')
    expect(d).toContain('Replacing the link keeps this as {versionWord(roundOf(detail))}')
  })
  it('the editing portal and the card show the newest round with pills for the others', () => {
    const portal = src('app/lib/editing-portal.ts')
    expect(portal).toContain('const rounds = roundsOf(clips)')
    expect(portal).toContain('version: fileRound(f), stream:')
    const c = src('app/components/portal/EditingReview.tsx')
    expect(c).toContain('const [round, setRound] = useState(data.rounds[0] ?? data.round)')
    expect(c).toContain('const clips = useMemo(() => data.clips.filter(c => c.version === round), [data.clips, round])')
    expect(c).toContain("{roundLabel(r)}{r === data.rounds[0] ? ' · latest' : ''}")
    const bar = src('app/dashboard/board/DrivePullBar.tsx')
    expect(bar).toContain('const shown = files.filter(f => fileRound(f) === shownRound)')
    expect(bar).toContain("{roundLabel(r)}{r === rounds[0] ? ' · latest' : ''}")
  })
})
