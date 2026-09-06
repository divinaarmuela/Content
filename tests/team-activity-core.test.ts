import { describe, it, expect } from 'vitest'
import {
  AGENCY_TZ, EMPTY_THROUGHPUT, addDaysKey, dueBucketOf, groupByStatusWord, holds, isFinished,
  overlayOf, recentDayKeys, sinceLabel, sortRows, sparkline, splitByTurn, splitDue,
  statusWordOf, summariseThroughput, throughputPeak, topOverdue, turnsFor, weekRangeInZone,
  weekdayIndex,
  type ActivityRow, type HeldItem, type TeamActivityRow,
} from '../app/lib/team-activity-core'
import { STATUS_TURN, type ItemStatus } from '../app/lib/workflow-core'
import { BRIEF_STATUS_TURN } from '../app/lib/brief-task-core'
import { TASK_STATUS_TURN } from '../app/lib/task-kind-core'

const ME = 'me'
const THEM = 'them'

const item = (over: Partial<HeldItem> = {}): HeldItem => ({
  id: 'i1', title: 'A reel', status: 'draft_uploaded', owner_id: ME,
  due_date: null, client_id: 'c1', client_name: 'ALIA', ...over,
})
const brief = (over: Partial<HeldItem> = {}) => item({ work_kinds: { slug: 'shoot_brief' }, ...over })
const task = (over: Partial<HeldItem> = {}) => item({ work_kinds: { slug: 'research', uses_media: false }, ...over })

describe('overlay — an item is read in its own vocabulary', () => {
  it('tells the three kinds apart', () => {
    expect(overlayOf(item())).toBe('asset')
    expect(overlayOf(brief())).toBe('brief')
    expect(overlayOf(task())).toBe('task')
    // no work kind at all is an asset — the default the pipeline was built on
    expect(overlayOf({ work_kinds: null })).toBe('asset')
  })

  it('each overlay is judged by its OWN turn table', () => {
    expect(turnsFor('asset')).toBe(STATUS_TURN)
    expect(turnsFor('brief')).toBe(BRIEF_STATUS_TURN)
    expect(turnsFor('task')).toBe(TASK_STATUS_TURN)
  })

  it('the status word is the item\'s own, never the raw status', () => {
    expect(statusWordOf(item({ status: 'internal_review' }))).toBe('Ready for checking')
    expect(statusWordOf(brief({ status: 'draft_uploaded' }))).toBe('Plan being written')
    expect(statusWordOf(task({ status: 'approved_for_scheduling' }))).toBe('Done')
    // nothing anywhere prints an underscore
    for (const s of ['draft_uploaded', 'client_changes_requested'] as ItemStatus[]) {
      expect(statusWordOf(item({ status: s }))).not.toMatch(/_/)
      expect(statusWordOf(brief({ status: s }))).not.toMatch(/_/)
      expect(statusWordOf(task({ status: s }))).not.toMatch(/_/)
    }
  })
})

describe('finished — nobody\'s turn, per overlay', () => {
  it('an asset is finished only once it is live', () => {
    expect(isFinished(item({ status: 'scheduled' }))).toBe(false)
    expect(isFinished(item({ status: 'published' }))).toBe(true)
  })
  it('a booked shoot brief is finished', () => {
    expect(isFinished(brief({ status: 'approved_for_scheduling' }))).toBe(false)
    expect(isFinished(brief({ status: 'scheduled' }))).toBe(true)
  })
  it('an approved task is done — there is nothing to schedule', () => {
    expect(isFinished(task({ status: 'approved_for_scheduling' }))).toBe(true)
    expect(isFinished(task({ status: 'internal_review' }))).toBe(false)
  })
})

describe('holding is assignment — owning it, or being handed its scheduling', () => {
  it('the owner holds it', () => {
    expect(holds(item({ owner_id: ME }), ME)).toBe(true)
    expect(holds(item({ owner_id: THEM }), ME)).toBe(false)
  })
  it('so does whoever the scheduling was handed to, whatever their title', () => {
    expect(holds(item({ owner_id: THEM, scheduler_ids: [ME] }), ME)).toBe(true)
  })
  it('a malformed scheduler_ids is nobody, not a crash', () => {
    expect(holds(item({ owner_id: THEM, scheduler_ids: 'me' }), ME)).toBe(false)
  })
})

describe('day-key arithmetic', () => {
  it('adds and subtracts days across a month boundary', () => {
    expect(addDaysKey('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('crosses a leap day', () => {
    expect(addDaysKey('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysKey('2028-03-01', -1)).toBe('2028-02-29')
  })
  it('Monday is 0 and Sunday is 6', () => {
    expect(weekdayIndex('2026-08-24')).toBe(0)   // a Monday
    expect(weekdayIndex('2026-08-27')).toBe(3)   // Thursday
    expect(weekdayIndex('2026-08-30')).toBe(6)   // Sunday
  })
})

describe('the agency week — Melbourne, Monday to Sunday, half-open', () => {
  it('a Thursday sits in the week that began on Monday', () => {
    const w = weekRangeInZone(new Date('2026-08-27T04:00:00Z'), AGENCY_TZ)
    expect(w.startKey).toBe('2026-08-24')
    expect(w.endKey).toBe('2026-08-30')
  })

  it('Monday itself starts its own week — not the one before', () => {
    const w = weekRangeInZone(new Date('2026-08-24T02:00:00Z'), AGENCY_TZ)
    expect(w.startKey).toBe('2026-08-24')
  })

  it('THE ZONE MATTERS: half past midnight Monday in Melbourne is still Sunday afternoon in London', () => {
    const monStartMelb = new Date('2026-08-23T14:30:00Z')   // Mon 00:30 Melbourne, Sun 15:30 London
    expect(weekRangeInZone(monStartMelb, AGENCY_TZ).startKey).toBe('2026-08-24')
    expect(weekRangeInZone(monStartMelb, 'Europe/London').startKey).toBe('2026-08-17')
  })

  it('the range is half-open, so the last second of Sunday night is inside it', () => {
    const w = weekRangeInZone(new Date('2026-08-27T04:00:00Z'), AGENCY_TZ)
    const lastMoment = new Date(new Date(w.endIso).getTime() - 1).toISOString()
    expect(lastMoment >= w.startIso).toBe(true)
    expect(lastMoment < w.endIso).toBe(true)
    // and the instant endIso names is the NEXT week's Monday, not inside it
    expect(weekRangeInZone(new Date(w.endIso), AGENCY_TZ).startKey).toBe('2026-08-31')
  })
})

describe('due buckets, on the client zone\'s calendar', () => {
  const TODAY = '2026-08-27'
  const WEEK_END = '2026-08-30'

  it('a date before today is overdue', () => {
    expect(dueBucketOf(item({ due_date: '2026-08-26' }), TODAY, WEEK_END)).toBe('overdue')
  })
  it('today is today, and also part of this week', () => {
    expect(dueBucketOf(item({ due_date: TODAY }), TODAY, WEEK_END)).toBe('today')
    const split = splitDue([item({ due_date: TODAY })], TODAY, WEEK_END)
    expect(split.today).toHaveLength(1)
    expect(split.this_week).toHaveLength(1)
  })
  it('the rest of the week is this week; past Sunday is later', () => {
    expect(dueBucketOf(item({ due_date: '2026-08-30' }), TODAY, WEEK_END)).toBe('week')
    expect(dueBucketOf(item({ due_date: '2026-08-31' }), TODAY, WEEK_END)).toBe('later')
  })
  it('no date is no bucket', () => {
    expect(dueBucketOf(item({ due_date: null }), TODAY, WEEK_END)).toBe('none')
  })

  it('THE RULE: finished work is never overdue, however old its date', () => {
    expect(dueBucketOf(item({ due_date: '2020-01-01', status: 'published' }), TODAY, WEEK_END)).toBe('none')
    expect(dueBucketOf(task({ due_date: '2020-01-01', status: 'approved_for_scheduling' }), TODAY, WEEK_END)).toBe('none')
    expect(dueBucketOf(brief({ due_date: '2020-01-01', status: 'scheduled' }), TODAY, WEEK_END)).toBe('none')
    // …but a scheduled ASSET is not finished — the post still has to go out
    expect(dueBucketOf(item({ due_date: '2020-01-01', status: 'scheduled' }), TODAY, WEEK_END)).toBe('overdue')
  })

  it('THE ZONE MATTERS: the same due date is overdue in one zone and due today in another', () => {
    const due = item({ due_date: '2026-08-26' })
    expect(dueBucketOf(due, '2026-08-27', WEEK_END)).toBe('overdue')   // Melbourne
    expect(dueBucketOf(due, '2026-08-26', WEEK_END)).toBe('today')     // still yesterday elsewhere
  })

  it('each bucket comes back soonest-first', () => {
    const split = splitDue([
      item({ id: 'b', due_date: '2026-08-25' }),
      item({ id: 'a', due_date: '2026-08-20' }),
    ], TODAY, WEEK_END)
    expect(split.overdue.map(i => i.id)).toEqual(['a', 'b'])
  })
})

describe('what a person is holding, grouped by the stage\'s own word', () => {
  it('counts by word, biggest pile first, and drops finished work', () => {
    const groups = groupByStatusWord([
      item({ id: '1', status: 'revision_required' }),
      item({ id: '2', status: 'revision_required' }),
      item({ id: '3', status: 'internal_review' }),
      item({ id: '4', status: 'published' }),
    ])
    expect(groups).toEqual([
      { word: 'Being changed', count: 2 },
      { word: 'Ready for checking', count: 1 },
    ])
  })
})

describe('your turn vs waiting on others', () => {
  const editor = { id: ME, role: 'editor' as const }

  it('a draft the editor owns is theirs to move', () => {
    const { mine, waiting } = splitByTurn([item({ status: 'draft_uploaded', owner_id: ME })], editor)
    expect(mine).toHaveLength(1)
    expect(waiting).toHaveLength(0)
  })

  it('the same item in review is waiting on a manager', () => {
    const { mine, waiting } = splitByTurn([item({ status: 'internal_review', owner_id: ME })], editor)
    expect(mine).toHaveLength(0)
    expect(waiting).toHaveLength(1)
  })

  it('a brief at draft is the ACCOUNT MANAGER\'s turn, not an editor\'s', () => {
    const b = brief({ status: 'draft_uploaded', owner_id: ME })
    expect(splitByTurn([b], editor).waiting).toHaveLength(1)
    expect(splitByTurn([b], { id: ME, role: 'account_manager' }).mine).toHaveLength(1)
  })

  it('finished work is in neither list', () => {
    const { mine, waiting } = splitByTurn([item({ status: 'published', owner_id: ME })], editor)
    expect(mine.concat(waiting)).toHaveLength(0)
  })

  it('undated work sorts after dated work, not before it', () => {
    const { mine } = splitByTurn([
      item({ id: 'none', due_date: null }),
      item({ id: 'soon', due_date: '2026-08-28' }),
    ], editor)
    expect(mine.map(i => i.id)).toEqual(['soon', 'none'])
  })
})

describe('throughput — counted from the trail, not from where work sits now', () => {
  const rows: ActivityRow[] = [
    { created_at: '2026-08-24T01:00:00Z', action: 'version_added', new_value: 'v2' },
    { created_at: '2026-08-24T02:00:00Z', action: 'status_change', new_value: 'internal_review' },
    { created_at: '2026-08-25T02:00:00Z', action: 'status_change', new_value: 'approved_for_scheduling' },
    { created_at: '2026-08-26T02:00:00Z', action: 'status_change', new_value: 'scheduled' },
    { created_at: '2026-08-26T03:00:00Z', action: 'status_change', new_value: 'published' },
    { created_at: '2026-08-26T04:00:00Z', action: 'status_change', new_value: 'revision_required' },
    { created_at: '2026-08-26T05:00:00Z', action: 'assigned', new_value: 'someone' },
  ]

  it('counts the five moves that are work, and ignores the rest', () => {
    expect(summariseThroughput(rows)).toEqual({
      versions: 1, submitted: 1, approved: 1, scheduled: 1, posted: 1,
    })
  })

  it('an empty week is five zeroes, not a missing object', () => {
    expect(summariseThroughput([])).toEqual(EMPTY_THROUGHPUT)
  })

  it('the mini-bars never divide by zero', () => {
    expect(throughputPeak(EMPTY_THROUGHPUT)).toBe(1)
    expect(throughputPeak({ ...EMPTY_THROUGHPUT, posted: 4 })).toBe(4)
  })
})

describe('the 14-day sparkline', () => {
  const now = new Date('2026-08-27T04:00:00Z')   // Thursday afternoon, Melbourne

  it('is one bucket per day, oldest first, ending today', () => {
    const keys = recentDayKeys(now, 14, AGENCY_TZ)
    expect(keys).toHaveLength(14)
    expect(keys[13]).toBe('2026-08-27')
    expect(keys[0]).toBe('2026-08-14')
  })

  it('files each row on the day its zone puts it', () => {
    const line = sparkline([
      { created_at: '2026-08-27T01:00:00Z', action: 'version_added' },
      { created_at: '2026-08-27T02:00:00Z', action: 'status_change' },
      { created_at: '2026-08-26T01:00:00Z', action: 'version_added' },
    ], now, 14, AGENCY_TZ)
    expect(line.find(d => d.day === '2026-08-27')?.count).toBe(2)
    expect(line.find(d => d.day === '2026-08-26')?.count).toBe(1)
    expect(line.find(d => d.day === '2026-08-25')?.count).toBe(0)
  })

  it('anything older than the window is dropped, not folded into day one', () => {
    const line = sparkline([{ created_at: '2020-01-01T00:00:00Z', action: 'version_added' }], now, 14, AGENCY_TZ)
    expect(line.reduce((n, d) => n + d.count, 0)).toBe(0)
  })

  it('a late-night Melbourne row lands on the Melbourne day, not the UTC one', () => {
    // 11pm on the 26th in Melbourne is 1pm UTC on the 26th; 1am on the 27th
    // Melbourne is 3pm UTC on the 26th — and belongs to the 27th
    const line = sparkline([{ created_at: '2026-08-26T15:00:00Z', action: 'version_added' }], now, 14, AGENCY_TZ)
    expect(line.find(d => d.day === '2026-08-27')?.count).toBe(1)
  })
})

describe('ordering the table', () => {
  const row = (over: Partial<TeamActivityRow>): TeamActivityRow => ({
    id: 'x', name: 'X', email: 'x@md.invalid', role: 'editor', timezone: AGENCY_TZ,
    last_active: null,
    holding: { total: 0, items: 0, shoots: 0, scheduling: 0, comments: 0, by_status: [] },
    due: { overdue: 0, today: 0, this_week: 0 },
    throughput: EMPTY_THROUGHPUT, activity: [], items: [], ...over,
  })

  const rows = [
    row({ id: 'a', name: 'Ana', due: { overdue: 0, today: 1, this_week: 2 }, holding: { total: 9, items: 9, shoots: 0, scheduling: 0, comments: 0, by_status: [] } }),
    row({ id: 'b', name: 'Bo', due: { overdue: 3, today: 0, this_week: 3 } }),
    row({ id: 'c', name: 'Cy', due: { overdue: 1, today: 0, this_week: 1 } }),
  ]

  it('overdue first is triage', () => {
    expect(sortRows(rows, 'overdue').map(r => r.id)).toEqual(['b', 'c', 'a'])
  })
  it('holding first is workload', () => {
    expect(sortRows(rows, 'holding').map(r => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('by name is by name, and never mutates the input', () => {
    expect(sortRows(rows, 'name').map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('the Overview card names the three to chase — and nobody who is clear', () => {
    expect(topOverdue(rows).map(r => r.id)).toEqual(['b', 'c'])
    expect(topOverdue([rows[0]])).toEqual([])
  })
})

describe('"2 h ago", in the reader\'s own terms', () => {
  const now = new Date('2026-08-27T04:00:00Z')
  it('reads the recent past in the units a person would use', () => {
    expect(sinceLabel('2026-08-27T03:59:40Z', now)).toBe('just now')
    expect(sinceLabel('2026-08-27T03:45:00Z', now)).toBe('15 m ago')
    expect(sinceLabel('2026-08-27T02:00:00Z', now)).toBe('2 h ago')
    expect(sinceLabel('2026-08-25T04:00:00Z', now)).toBe('2 d ago')
  })
  it('past a fortnight it becomes a date, because "19 d ago" is not a fact anyone uses', () => {
    expect(sinceLabel('2026-08-01T04:00:00Z', now, AGENCY_TZ)).toBe('2026-08-01')
  })
  it('never is never — not "56 years ago"', () => {
    expect(sinceLabel(null, now)).toBe('never')
    expect(sinceLabel('not a date', now)).toBe('never')
  })
})
