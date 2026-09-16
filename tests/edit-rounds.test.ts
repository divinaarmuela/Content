import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SENT_BACK_STATUSES, fileRound, nextRound, roundLabel, roundOf, roundsOf } from '../app/lib/edit-round-core'

/**
 * VERSION 1, VERSION 2, VERSION 3 (the owner, 16 Sep 2026: "once we upload
 * the Drive it downloads and is shown as version 1; when it gets sent back
 * to the editor from any point they upload the same Drive link but have to
 * re-download for version 2, because comments will be there; or sometimes
 * they upload a different Drive link — doesn't matter").
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

describe('rounds (pure)', () => {
  it('a card starts at round 1; a send-back opens the next; the words', () => {
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
  it('a send-back bumps the round in the same write as the status', () => {
    const w = src('app/lib/workflow.ts')
    expect(w).toContain("...(SENT_BACK_STATUSES.includes(to) && !isBriefTask && !isInternal ? { edit_round: nextRound(before as never) } : {}),")
  })
  it('every pull is tagged with the card’s round; the same link handed in again, and revisions done, pull again', () => {
    expect(src('app/api/drive/pull/route.ts')).toContain('version: roundOf(item), by: user.id')
    expect(src('app/api/production/items/[id]/route.ts')).toContain('version: roundOf(data), by: user.id')
    const link = src('app/api/production/items/[id]/link/route.ts')
    expect(link.split('version: roundOf(item), by: user.id')).toHaveLength(3)
    const t = src('app/api/production/items/[id]/transition/route.ts')
    expect(t).toContain("if (SENT_BACK_STATUSES.includes(String(item.status)) && to === 'quality_check') {")
    expect(t).toContain("if (finished) startPullSoon({ kind: 'item', scopeId: id, folderUrl: finished.url, version: roundOf(item), by: user.id })")
    // a file already here keeps the round it arrived with; a new file gets the current one
    const p = src('app/lib/drive-pull.ts')
    expect(p).toContain("if (had && had.status === 'done' && had.url && had.size === f.size) return { ...had, name: f.name }")
    expect(p).toContain("status: 'waiting', upload_id: null, parts: [], version: version ?? null }")
  })
  it('the editing portal and the card show the newest round with pills for the others', () => {
    const portal = src('app/lib/editing-portal.ts')
    expect(portal).toContain('const rounds = roundsOf(clips)')
    expect(portal).toContain('version: fileRound(f) }')
    const c = src('app/components/portal/EditingReview.tsx')
    expect(c).toContain('const [round, setRound] = useState(data.rounds[0] ?? data.round)')
    expect(c).toContain('const clips = useMemo(() => data.clips.filter(c => c.version === round), [data.clips, round])')
    expect(c).toContain("{roundLabel(r)}{r === data.rounds[0] ? ' · latest' : ''}")
    const bar = src('app/dashboard/board/DrivePullBar.tsx')
    expect(bar).toContain('const shown = files.filter(f => fileRound(f) === shownRound)')
    expect(bar).toContain("{roundLabel(r)}{r === rounds[0] ? ' · latest' : ''}")
  })
})
