import { describe, expect, it } from 'vitest'
import {
  beginMove, dragBlockReason, dropLabel, dropLabelAt, finishMove, isMoveKey, keyboardMove,
  KEY_STEP_MINUTES, LONG_PRESS_MS, mayDragTile, moveToDay, movedAnnouncement,
  dropIntent, movingAnnouncement, NO_MOVES, previewOrder, settledIds, shouldCommit,
  snapToStep, SNAP_MINUTES, recentlyMoved, AFTER_MOVE_QUIET_MS,
} from '@/app/lib/schedule-drag-core'
import { groupForList, nearbyDayLabel, scheduleWeekGrid } from '@/app/lib/social-schedule-core'
import { formatInZone, wallTimeIn } from '@/app/lib/timezone-core'

/**
 * DRAGGING A POST TO A NEW TIME — the arithmetic, with no browser in the way.
 *
 * These are the sums that decide when a real post goes out to a real
 * audience, so they are tested where they can be tested exactly: a pure
 * function, a fixed zone, and a day the clocks change in it.
 */

const TZ = 'Australia/Melbourne'

describe('snapping', () => {
  it('lands on the quarter hour, like a click does', () => {
    expect(SNAP_MINUTES).toBe(15)
    expect(snapToStep(607)).toBe(600)   // 10:07 → 10:00
    expect(snapToStep(613)).toBe(615)   // 10:13 → 10:15
    expect(snapToStep(622)).toBe(615)
    expect(snapToStep(623)).toBe(630)
  })

  it('a snapped time is a time the grid can read back', () => {
    const grid = scheduleWeekGrid({ start: '2026-09-09', tz: TZ })
    // the pixel half way down the 10 AM row is 10:30, and dropping there is
    // the same minute a click there would mean
    const slot = grid.slotAt(2, grid.headerPx + 4 * grid.rowPx + grid.rowPx / 2)
    expect(slot?.hour).toBe(10)
    expect(slot?.minute).toBe(30)
  })

  it('refuses to invent a number out of nonsense', () => {
    expect(snapToStep(Number.NaN)).toBe(0)
    expect(snapToStep(600, 0)).toBe(600)
  })
})

describe('the label under the pointer', () => {
  it('says what letting go would do', () => {
    expect(dropLabel('2:00 pm')).toBe('Drop · 2:00 pm')
  })

  it('falls back rather than showing a dangling separator', () => {
    expect(dropLabel(null)).toBe('Drop here')
    expect(dropLabel('   ')).toBe('Drop here')
  })

  it('reads the time in the CLIENT’s zone, not the viewer’s', () => {
    // 04:00 UTC is 2 pm in Melbourne on this date
    expect(dropLabelAt('2026-09-09T04:00:00.000Z', TZ)).toBe('Drop · 2:00 pm')
    expect(dropLabelAt(null, TZ)).toBe('Drop here')
  })
})

describe('moving with the keyboard', () => {
  const at = (iso: string) => wallTimeIn(iso, TZ)!

  it('up and down are half an hour', () => {
    expect(KEY_STEP_MINUTES).toBe(30)
    const start = '2026-09-09T04:00:00.000Z'          // 2:00 pm Melbourne
    const down = keyboardMove(start, 'ArrowDown', TZ)!
    const up = keyboardMove(start, 'ArrowUp', TZ)!
    expect(at(down).hour * 60 + at(down).minute).toBe(14 * 60 + 30)
    expect(at(up).hour * 60 + at(up).minute).toBe(13 * 60 + 30)
  })

  it('left and right are a whole day, at the same time of day', () => {
    const start = '2026-09-09T04:00:00.000Z'
    const right = keyboardMove(start, 'ArrowRight', TZ)!
    expect(at(right).day).toBe(at(start).day + 1)
    expect(at(right).hour).toBe(at(start).hour)
    expect(at(right).minute).toBe(at(start).minute)
    const left = keyboardMove(start, 'ArrowLeft', TZ)!
    expect(at(left).day).toBe(at(start).day - 1)
    expect(at(left).hour).toBe(at(start).hour)
  })

  it('a day is still a day the weekend the clocks change', () => {
    // Melbourne moves to daylight saving on 4 October 2026 at 2 am
    const before = '2026-10-03T01:00:00.000Z'          // 11:00 am, Sat 3 Oct
    const next = keyboardMove(before, 'ArrowRight', TZ)!
    expect(at(next).day).toBe(4)
    expect(at(next).hour).toBe(11)
    expect(at(next).minute).toBe(0)
    // and the instant really did move by 23 hours, not 24 — which is the
    // whole reason this is done on the wall clock
    expect(Date.parse(next) - Date.parse(before)).toBe(23 * 3_600_000)
  })

  it('carries midnight over to the next day rather than wrapping in place', () => {
    const late = '2026-09-09T13:45:00.000Z'            // 11:45 pm Melbourne
    // the day really does turn over — and the post is then pulled into the
    // hours the grid draws, rather than left at 12:15 am where no column
    // could show it
    const later = keyboardMove(late, 'ArrowDown', TZ)!
    expect(at(later).day).toBe(at(late).day + 1)
    expect(at(later).hour).toBe(6)
    expect(at(later).minute).toBe(0)
    // with a window that HAS a midnight in it, the minute is kept
    const open = keyboardMove(late, 'ArrowDown', TZ, { fromHour: 0, toHour: 23 })!
    expect(at(open).day).toBe(at(late).day + 1)
    expect(at(open).hour).toBe(0)
    expect(at(open).minute).toBe(15)
  })

  it('ignores every key that is not an arrow, and a post with no time', () => {
    expect(isMoveKey('ArrowUp')).toBe(true)
    expect(isMoveKey('Tab')).toBe(false)
    expect(keyboardMove('2026-09-09T04:00:00.000Z', 'Tab', TZ)).toBeNull()
    expect(keyboardMove(null, 'ArrowUp', TZ)).toBeNull()
    expect(keyboardMove('not a time', 'ArrowUp', TZ)).toBeNull()
  })

  it('a stepped time is still on the quarter hour', () => {
    const odd = '2026-09-09T04:07:00.000Z'             // 2:07 pm
    const moved = keyboardMove(odd, 'ArrowDown', TZ)!
    expect(at(moved).minute % 15).toBe(0)
  })

  it('stops at the edges of the hours the grid draws', () => {
    // 6:00 am — the top of the grid. Up again must not walk the post off it
    const dawn = '2026-09-08T20:00:00.000Z'
    expect(at(dawn).hour).toBe(6)
    const higher = keyboardMove(dawn, 'ArrowUp', TZ)!
    expect(at(higher).hour).toBe(6)
    expect(at(higher).minute).toBe(0)

    // 8:00 pm — the bottom
    const dusk = '2026-09-09T10:00:00.000Z'
    expect(at(dusk).hour).toBe(20)
    const lower = keyboardMove(dusk, 'ArrowDown', TZ)!
    expect(at(lower).hour).toBe(20)
    expect(at(lower).minute).toBe(0)
  })

  it('takes a wider window when the grid draws one', () => {
    const dawn = '2026-09-08T20:00:00.000Z'            // 6 am
    const higher = keyboardMove(dawn, 'ArrowUp', TZ, { fromHour: 0, toHour: 23 })!
    expect(at(higher).hour).toBe(5)
    expect(at(higher).minute).toBe(30)
  })
})

describe('dropping a post on another day in the month', () => {
  it('keeps the time of day', () => {
    const evening = '2026-09-09T08:30:00.000Z'         // 6:30 pm Melbourne
    const moved = moveToDay(evening, '2026-09-25', TZ)!
    expect(formatInZone(moved, TZ, 'full')).toBe('Fri 25 Sept, 6:30 pm')
  })

  it('keeps the time of day across the change of the clocks', () => {
    const before = '2026-10-02T08:30:00.000Z'          // 6:30 pm Fri 2 Oct
    const after = moveToDay(before, '2026-10-05', TZ)!
    // still half past six in the evening, though the offset is an hour bigger
    expect(formatInZone(after, TZ, 'time')).toBe('6:30 pm')
  })

  it('uses the client’s usual time when the post has none yet', () => {
    expect(formatInZone(moveToDay(null, '2026-09-25', TZ)!, TZ, 'time')).toBe('11:00 am')
    expect(formatInZone(moveToDay(null, '2026-09-25', TZ, '18:00')!, TZ, 'time')).toBe('6:00 pm')
  })

  it('refuses anything that is not a day', () => {
    expect(moveToDay('2026-09-09T08:30:00.000Z', 'Friday', TZ)).toBeNull()
    expect(moveToDay('2026-09-09T08:30:00.000Z', '', TZ)).toBeNull()
  })
})

describe('what may be picked up', () => {
  it('lets a post that has not gone out move', () => {
    for (const status of ['draft', 'pending', 'approved', 'changes', 'scheduled']) {
      expect(mayDragTile({ status }), status).toBe(true)
      expect(dragBlockReason({ status })).toBeNull()
    }
  })

  it('holds a finished post still, and says why in plain words', () => {
    for (const status of ['published', 'failed', 'cancelled']) {
      expect(mayDragTile({ status }), status).toBe(false)
      const why = dragBlockReason({ status })!
      expect(why).toMatch(/[a-z]/)
      expect(why).not.toMatch(/error|invalid|null|undefined/i)
    }
    expect(dragBlockReason({ status: 'published' })).toMatch(/already gone out/)
  })
})

describe('what a screen reader is told', () => {
  it('names the post and the whole time once it lands', () => {
    expect(movedAnnouncement('Spring launch', '2026-09-09T04:00:00.000Z', TZ))
      .toBe('Spring launch moved to Wed 9 Sept, 2:00 pm')
  })

  it('says which keys do what while it is in the air', () => {
    const said = movingAnnouncement('Spring launch', '2026-09-09T04:00:00.000Z', TZ)
    expect(said).toContain('Wed 9 Sept, 2:00 pm')
    expect(said).toContain('Enter to confirm')
    expect(said).toContain('Escape to cancel')
  })

  it('still says something for a post with no title or no time', () => {
    expect(movedAnnouncement(null, null, TZ)).toBe('Post moved')
    expect(movingAnnouncement('', null, TZ)).toContain('arrow keys')
  })
})

describe('the feed preview', () => {
  const post = (id: string, scheduled_for: string | null) => ({ id, scheduled_for })

  it('reads like the profile will: the last post scheduled, top left', () => {
    const ordered = previewOrder([
      post('a', '2026-09-10T00:00:00.000Z'),
      post('c', '2026-09-20T00:00:00.000Z'),
      post('b', '2026-09-12T00:00:00.000Z'),
    ])
    expect(ordered.map(p => p.id)).toEqual(['c', 'b', 'a'])
  })

  it('runs what is planned straight into what is already up', () => {
    const ordered = previewOrder([
      post('old', '2026-08-01T00:00:00.000Z'),
      post('next', '2026-09-10T00:00:00.000Z'),
      post('recent', '2026-09-08T00:00:00.000Z'),
    ])
    expect(ordered.map(p => p.id)).toEqual(['next', 'recent', 'old'])
  })

  it('leaves out a post that has no time at all', () => {
    expect(previewOrder([post('a', null), post('b', 'soon')])).toEqual([])
  })
})

/* —— the sequence a move goes through —————————————————————————————————————————— */

describe('a move, from the drop to the server\u2019s answer', () => {
  const MOVE = { postId: 'p1', title: 'Spring launch', iso: '2026-09-09T04:00:00.000Z', tz: TZ }

  it('draws the tile at the new time straight away, and marks it unsettled', () => {
    const after = beginMove(NO_MOVES, MOVE)
    expect(after.optimistic).toEqual({ p1: MOVE.iso })
    expect(after.saving).toEqual(['p1'])
    expect(after.announcement).toContain('moved to')
  })

  it('hands the tile back to the listener the moment the server says yes', () => {
    const after = finishMove(beginMove(NO_MOVES, MOVE), { postId: 'p1', ok: true })
    // no drawn time left over: a snapshot that never repeats this exact value
    // — because somebody else moved the post again — cannot strand the tile
    expect(after.optimistic).toEqual({})
    expect(after.saving).toEqual([])
    expect(after.message).toBeNull()
  })

  it('snaps the tile back and shows the SERVER\u2019s sentence on a refusal', () => {
    const refused = finishMove(beginMove(NO_MOVES, MOVE), {
      postId: 'p1',
      title: 'Spring launch',
      ok: false,
      error: 'This post has already gone out, so it cannot be moved',
    })
    expect(refused.optimistic).toEqual({})
    expect(refused.saving).toEqual([])
    expect(refused.message).toBe('This post has already gone out, so it cannot be moved')
    expect(refused.announcement).toContain('stayed where it was')
  })

  it('still says something plain when a refusal came with no words', () => {
    const refused = finishMove(beginMove(NO_MOVES, MOVE), { postId: 'p1', ok: false })
    expect(refused.message).toBe('That move did not save. Try again.')
  })

  it('leaves another post\u2019s move alone while one is answered', () => {
    const two = beginMove(beginMove(NO_MOVES, MOVE), { ...MOVE, postId: 'p2' })
    const one = finishMove(two, { postId: 'p1', ok: true })
    expect(one.optimistic).toEqual({ p2: MOVE.iso })
    expect(one.saving).toEqual(['p2'])
  })

  it('writes nothing when a tile is dropped back where it already was', () => {
    expect(shouldCommit(MOVE.iso, MOVE.iso)).toBe(false)
    expect(shouldCommit(MOVE.iso, null)).toBe(false)
    expect(shouldCommit(null, MOVE.iso)).toBe(true)
    expect(shouldCommit(MOVE.iso, '2026-09-09T05:00:00.000Z')).toBe(true)
  })
})

describe('what a column has been handed', () => {
  const KINDS = { post: 'application/x-md-post', media: 'application/x-md-item' }

  it('tells a post being moved from a piece of media starting one', () => {
    expect(dropIntent([KINDS.post], KINDS)).toBe('post')
    expect(dropIntent([KINDS.media], KINDS)).toBe('media')
    expect(dropIntent(['text/plain'], KINDS)).toBeNull()
    expect(dropIntent([], KINDS)).toBeNull()
  })

  it('still knows a post is in the air when the browser hides the payload', () => {
    // Safari does not expose the types over some elements; the page knows it
    // lifted a tile, and that is the more reliable fact
    expect(dropIntent([], KINDS, true)).toBe('post')
  })

  it('gives a rail card dropped on the week the minute it was dropped on', () => {
    const grid = scheduleWeekGrid({ start: '2026-09-09', tz: TZ })
    // Wednesday, half way down the 2 PM row
    const slot = grid.slotAt(2, grid.headerPx + 8 * grid.rowPx + grid.rowPx / 2)
    expect(slot?.dayKey).toBe('2026-09-09')
    expect(slot?.hour).toBe(14)
    expect(slot?.minute).toBe(30)
    // which is the ISO the composer is opened with, alongside the item id
    expect(formatInZone(slot!.iso, TZ, 'full')).toBe('Wed 9 Sept, 2:30 pm')
  })

  it('gives a rail card dropped on a month DAY the client’s usual time', () => {
    // a month cell has no hour in it; the drop means "that day, as usual"
    const at = moveToDay(null, '2026-09-25', TZ, '18:30')!
    expect(formatInZone(at, TZ, 'full')).toBe('Fri 25 Sept, 6:30 pm')
  })
})

describe('when this browser stops overriding the listener', () => {
  const OPT = { p1: '2026-09-09T04:00:00.000Z', p2: '2026-09-10T04:00:00.000Z' }

  it('lets go once the live row says the same thing', () => {
    expect(settledIds([
      { id: 'p1', scheduled_for: OPT.p1 },
      { id: 'p2', scheduled_for: '2026-09-01T04:00:00.000Z' },
    ], OPT)).toEqual(['p1'])
  })

  it('lets go of a post that is not on the page any more', () => {
    // another client picked, or a channel filter took it away: the entry has
    // nobody left to own it
    expect(settledIds([{ id: 'p2', scheduled_for: OPT.p2 }], OPT)).toEqual(['p1', 'p2'])
  })

  it('holds on while the row still says something else', () => {
    expect(settledIds([
      { id: 'p1', scheduled_for: '2026-09-09T02:00:00.000Z' },
      { id: 'p2', scheduled_for: '2026-09-09T02:00:00.000Z' },
    ], OPT)).toEqual([])
  })

  it('has nothing to do when nothing was moved', () => {
    expect(settledIds([{ id: 'p1', scheduled_for: OPT.p1 }], {})).toEqual([])
  })
})

describe('the list view reads the way a person thinks about days', () => {
  const TODAY = '2026-09-09'

  it('names today, tomorrow and yesterday', () => {
    expect(nearbyDayLabel('2026-09-09', TODAY)).toBe('Today')
    expect(nearbyDayLabel('2026-09-10', TODAY)).toBe('Tomorrow')
    expect(nearbyDayLabel('2026-09-08', TODAY)).toBe('Yesterday')
  })

  it('dates anything further away, rather than counting', () => {
    expect(nearbyDayLabel('2026-09-12', TODAY)).toBeNull()
    expect(nearbyDayLabel('2026-09-09', null)).toBeNull()
    expect(nearbyDayLabel('nonsense', TODAY)).toBeNull()
  })

  it('groups a week into headings, in order, with today named', () => {
    const groups = groupForList([
      { id: 'later', scheduled_for: '2026-09-12T02:00:00.000Z' },
      { id: 'today', scheduled_for: '2026-09-09T04:00:00.000Z' },
      { id: 'tomorrow', scheduled_for: '2026-09-10T04:00:00.000Z' },
      { id: 'none', scheduled_for: null },
    ] as { id: string; scheduled_for: string | null }[], TZ, TODAY)
    expect(groups.map(g => g.label)).toEqual(['No time yet', 'Today', 'Tomorrow', 'Sat 12 Sept'])
  })

  it('is unchanged for a caller that does not know the client’s today', () => {
    const groups = groupForList(
      [{ id: 'a', scheduled_for: '2026-09-09T04:00:00.000Z' }], TZ)
    expect(groups[0].label).toBe('Wed 9 Sept')
  })
})

describe('the long press', () => {
  it('is long enough to scroll past a tile, short enough to feel deliberate', () => {
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(300)
    expect(LONG_PRESS_MS).toBeLessThanOrEqual(600)
  })
})

describe('the click a finger leaves behind when it lets go', () => {
  const T = 1_756_000_000_000

  it('ignores a tap in the moment after a finger drag', () => {
    expect(recentlyMoved(T, T)).toBe(true)
    expect(recentlyMoved(T, T + AFTER_MOVE_QUIET_MS - 1)).toBe(true)
  })

  it('lets a real tap through once that moment has passed', () => {
    expect(recentlyMoved(T, T + AFTER_MOVE_QUIET_MS)).toBe(false)
    expect(recentlyMoved(T, T + 5000)).toBe(false)
  })

  it('never swallows a tap on a tile nobody has dragged', () => {
    expect(recentlyMoved(0, T)).toBe(false)
    expect(recentlyMoved(Number.NaN, T)).toBe(false)
  })

  it('is short enough not to feel broken and long enough to catch the echo', () => {
    expect(AFTER_MOVE_QUIET_MS).toBeGreaterThanOrEqual(300)
    expect(AFTER_MOVE_QUIET_MS).toBeLessThanOrEqual(800)
  })
})
