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
    expect(src('app/api/drive/pull/route.ts')).toContain('version: finished ? roundOf(item) : 1, by: user.id')
    // a folder to work from is never a version
    expect(src('app/api/production/items/[id]/route.ts')).toContain('version: 1, by: user.id')
    const link = src('app/api/production/items/[id]/link/route.ts')
    expect(link).toContain("if (check.kind === 'drive' && final) startPullSoon({ kind: 'item', scopeId: id, folderUrl: check.url, version: handInRound(item), by: user.id })")
    expect(link).toContain('version: final ? handInRound(item) : 1, by: user.id')
    const t = src('app/api/production/items/[id]/transition/route.ts')
    expect(t).toContain("if (SENT_BACK_STATUSES.includes(String(item.status)) && to === 'quality_check') {")
    expect(t).toContain("if (finished) startPullSoon({ kind: 'item', scopeId: id, folderUrl: finished.url, version: round, by: user.id })")
    // a file already here keeps the round it arrived with; a new file gets the current one
    const p = src('app/lib/drive-pull.ts')
    expect(p).toContain("if (had && had.status === 'done' && had.url && had.size === f.size) return { ...had, name: f.name }")
    expect(p).toContain("status: 'waiting', upload_id: null, parts: [], version: version ?? null }")
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
