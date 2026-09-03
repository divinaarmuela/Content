import { describe, it, expect } from 'vitest'
import {
  eligibility, mirrorStatus, tileTone, scheduleWeekGrid, monthCells, canReschedule,
  suggestedTimes, slideLimits, applySlideLimit, groupForList, validateComposition,
  blockReason,
  type SocialPostStatus,
} from '@/app/lib/social-schedule-core'
import { fromZonedInput, toZonedInput, dayKeyInZone } from '@/app/lib/timezone-core'
import type { Slide } from '@/app/lib/version-files-core'

const TZ = 'Australia/Melbourne'

const img = (n: number): Slide => ({
  url: `https://cdn.example.com/a/${n}.jpg`, name: `${n}.jpg`, type: 'image',
})
const vid = (n: number): Slide => ({
  url: `https://cdn.example.com/a/${n}.mp4`, name: `${n}.mp4`, type: 'video',
})
const at = (local: string, tz = TZ) => fromZonedInput(local, tz) as string

/* ── eligibility ────────────────────────────────────────────────────────── */

describe('eligibility', () => {
  const version = { id: 'v1', version_number: 2, files: [img(1), img(2)], file_url: null }

  it('lets an approved item with media start a post', () => {
    const r = eligibility({ status: 'approved_for_scheduling', content_type: 'carousel' }, [version])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.version.id).toBe('v1')
      expect(r.slides).toHaveLength(2)
    }
  })

  it('lets an already scheduled item start another post', () => {
    expect(eligibility({ status: 'scheduled', content_type: 'static' }, [version]).ok).toBe(true)
  })

  it('takes the LATEST version, not the first in the array', () => {
    const r = eligibility({ status: 'scheduled', content_type: 'carousel' }, [
      { id: 'v1', version_number: 1, files: [img(1)] },
      { id: 'v3', version_number: 3, files: [img(7), img(8)] },
      { id: 'v2', version_number: 2, files: [img(4)] },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.version.id).toBe('v3')
  })

  it('says the item is still with the client in plain words', () => {
    const r = eligibility({ status: 'client_review' }, [version])
    expect(r).toEqual({ ok: false, reason: 'Still with the client' })
  })

  it('says changes are in progress', () => {
    for (const status of ['client_changes_requested', 'revision_required', 'revision_complete']) {
      expect(eligibility({ status }, [version])).toEqual({ ok: false, reason: 'Changes in progress' })
    }
  })

  it('says the work is still being made', () => {
    for (const status of ['draft_uploaded', 'internal_review']) {
      expect(eligibility({ status }, [version])).toEqual({ ok: false, reason: 'Still being made' })
    }
  })

  it('says an already-posted item has already posted', () => {
    expect(eligibility({ status: 'published' }, [version]))
      .toEqual({ ok: false, reason: 'Already posted' })
  })

  it('says nothing else is ready yet', () => {
    for (const status of ['', null]) {
      expect(eligibility({ status }, [version])).toEqual({ ok: false, reason: 'Not ready yet' })
    }
  })

  it('an approved item with no version at all has no media yet', () => {
    expect(eligibility({ status: 'approved_for_scheduling' }, []))
      .toEqual({ ok: false, reason: 'No media yet' })
  })

  it('an approved item whose version is only a review link has no media yet', () => {
    const link = { id: 'v9', version_number: 1, files: [], file_url: null }
    expect(eligibility({ status: 'approved_for_scheduling' }, [link]))
      .toEqual({ ok: false, reason: 'No media yet' })
  })

  it('counts only the slides that actually go out: a Reel posts one', () => {
    const reel = { id: 'v4', version_number: 1, files: [vid(1), img(2)] }
    const r = eligibility({ status: 'scheduled', content_type: 'reel' }, [reel])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.slides).toEqual([vid(1)])
  })
})

/* ── mirrorStatus ───────────────────────────────────────────────────────── */

describe('mirrorStatus', () => {
  const post = { status: 'draft' }

  it('mirrors the item approval state when nothing is queued', () => {
    for (const [state, want] of [
      ['pending', 'pending'], ['approved', 'approved'], ['changes', 'changes'], ['draft', 'draft'],
    ] as const) {
      expect(mirrorStatus({ posting_approval_state: state }, post, [])).toBe(want)
    }
  })

  it('an item the gate never touched reads as a draft', () => {
    expect(mirrorStatus({ posting_approval_state: null }, post, [])).toBe('draft')
    expect(mirrorStatus(null, null, [])).toBe('draft')
  })

  it('a live job outranks the approval state', () => {
    for (const s of ['queued', 'publishing', 'scheduled']) {
      expect(mirrorStatus({ posting_approval_state: 'approved' }, post, [{ status: s }]))
        .toBe('scheduled')
    }
  })

  it('reads published, failed and cancelled off the jobs', () => {
    expect(mirrorStatus({ posting_approval_state: 'approved' }, post, [{ status: 'published' }]))
      .toBe('published')
    expect(mirrorStatus({ posting_approval_state: 'approved' }, post, [{ status: 'failed' }]))
      .toBe('failed')
    expect(mirrorStatus({ posting_approval_state: 'approved' }, post, [{ status: 'cancelled' }]))
      .toBe('cancelled')
  })

  it('one channel still to go out keeps the whole post scheduled', () => {
    expect(mirrorStatus({ posting_approval_state: 'approved' }, post, [
      { status: 'published' }, { status: 'queued' },
    ])).toBe('scheduled')
  })

  it('a failure on any channel is louder than a success on another', () => {
    expect(mirrorStatus({ posting_approval_state: 'approved' }, post, [
      { status: 'published' }, { status: 'failed' },
    ])).toBe('failed')
  })

  it('ignores a job status it does not know', () => {
    expect(mirrorStatus({ posting_approval_state: 'pending' }, post, [{ status: 'weird' }]))
      .toBe('pending')
  })

  it('agrees with canReschedule on a cancelled post with no jobs', () => {
    // the item still reads 'approved' — only the post itself was cancelled —
    // and that must still win, or the tile would claim it could be dragged
    // when canReschedule would refuse the drop
    const cancelled = { status: 'cancelled' }
    expect(mirrorStatus({ posting_approval_state: 'approved' }, cancelled, [])).toBe('cancelled')
    expect(canReschedule(cancelled).ok).toBe(false)
  })
})

describe('blockReason', () => {
  it('gives back the sentence the server would refuse with', () => {
    expect(blockReason({ posting_approval_state: 'approved' })).toBeNull()
    expect(blockReason({ posting_approval_state: null })).toBeNull()
    expect(blockReason({ posting_approval_state: 'pending' }))
      .toMatch(/Waiting on final approval/)
    expect(blockReason({ posting_approval_state: 'changes' }))
      .toMatch(/^Changes were asked for/)
    expect(blockReason({ posting_approval_state: 'draft' }))
      .toBe('Send the post for approval first')
  })
})

/* ── tileTone ───────────────────────────────────────────────────────────── */

describe('tileTone', () => {
  it('gives every status its tone', () => {
    const want: Record<SocialPostStatus, string> = {
      pending: 'amber', changes: 'red', approved: 'green', scheduled: 'blue',
      published: 'ink', draft: 'muted', failed: 'red-outline', cancelled: 'muted',
    }
    for (const [status, tone] of Object.entries(want)) {
      expect(tileTone(status as SocialPostStatus)).toBe(tone)
    }
  })
  it('falls back to muted for anything unknown', () => {
    expect(tileTone('nonsense')).toBe('muted')
    expect(tileTone(null)).toBe('muted')
  })
})

/* ── scheduleWeekGrid ───────────────────────────────────────────────────── */

describe('scheduleWeekGrid', () => {
  const g = scheduleWeekGrid({ start: '2026-08-26', tz: TZ })

  it('is Monday-first and seven days wide', () => {
    expect(g.days.map(d => d.iso)).toEqual([
      '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
      '2026-08-28', '2026-08-29', '2026-08-30',
    ])
    expect(g.days[0].weekday).toBe('Monday')
  })

  it('runs 6 am to 8 pm by the hour', () => {
    expect(g.hours[0]).toBe(6)
    expect(g.hours[g.hours.length - 1]).toBe(20)
    expect(g.hours).toHaveLength(15)
    expect(g.height).toBe(40 + 14 * 44)
  })

  it('puts a tile at the right height for its time in the client zone', () => {
    const p = g.tileTop(at('2026-08-27T09:30'))
    expect(p).not.toBeNull()
    expect(p!.dayIndex).toBe(3)
    expect(p!.top).toBe(40 + 3.5 * 44)
    expect(p!.offGrid).toBe(false)
  })

  it('a post at 8 pm exactly is on the grid, at the last row', () => {
    const p = g.tileTop(at('2026-08-27T20:00'))
    expect(p!.offGrid).toBe(false)
    expect(p!.top).toBe(40 + 14 * 44)
  })

  it('a post past the last hour clamps and is flagged off the grid', () => {
    const late = g.tileTop(at('2026-08-27T22:15'))
    expect(late!.offGrid).toBe(true)
    expect(late!.top).toBe(40 + 14 * 44)
    const early = g.tileTop(at('2026-08-27T05:00'))
    expect(early!.offGrid).toBe(true)
    expect(early!.top).toBe(40)
  })

  it('returns null for a time in another week or for nonsense', () => {
    expect(g.tileTop(at('2026-09-03T09:00'))).toBeNull()
    expect(g.tileTop('not a time')).toBeNull()
  })

  it('buckets by the CLIENT clock, not the viewer or UTC', () => {
    // 9 am Thursday in Melbourne is still Wednesday night in UTC
    const iso = at('2026-08-27T09:00')
    expect(iso.slice(0, 10)).toBe('2026-08-26')
    expect(g.tileTop(iso)!.dayIndex).toBe(3)
  })

  it('slotAt turns a click into a time, and tileTop puts it back', () => {
    for (const px of [40, 40 + 11, 40 + 44, 40 + 3 * 44 + 22, 40 + 14 * 44]) {
      const slot = g.slotAt(2, px)
      expect(slot).not.toBeNull()
      const back = g.tileTop(slot!.iso)
      expect(back!.dayIndex).toBe(2)
      expect(back!.top).toBe(px)
      expect(back!.offGrid).toBe(false)
    }
  })

  it('slotAt snaps to a quarter hour and clamps to the visible range', () => {
    expect(g.slotAt(0, 40 + 8)!.minute).toBe(15)
    expect(g.slotAt(0, 40 + 5)!.minute).toBe(0)
    expect(g.slotAt(0, -500)).toMatchObject({ hour: 6, minute: 0 })
    expect(g.slotAt(0, 99999)).toMatchObject({ hour: 20, minute: 0 })
    expect(g.slotAt(9, 100)).toBeNull()
    expect(g.slotAt(-1, 100)).toBeNull()
  })

  it('the slot carries the day it belongs to and a plain time label', () => {
    const slot = g.slotAt(4, 40 + 8 * 44)!
    expect(slot.dayKey).toBe('2026-08-28')
    expect(slot.hour).toBe(14)
    expect(slot.label).toBe('2:00 pm')
    expect(dayKeyInZone(slot.iso, TZ)).toBe('2026-08-28')
  })

  it('survives the week the clocks go forward in Melbourne', () => {
    // AEST → AEDT at 2 am on Sunday 4 October 2026
    const dst = scheduleWeekGrid({ start: '2026-10-04', tz: TZ })
    expect(dst.days.map(d => d.iso)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01',
      '2026-10-02', '2026-10-03', '2026-10-04',
    ])
    // the same wall time on either side of the jump sits at the same height
    const before = dst.tileTop(at('2026-10-03T10:00'))!
    const after = dst.tileTop(at('2026-10-04T10:00'))!
    expect(before.top).toBe(after.top)
    expect(after.dayIndex).toBe(6)
    // and a click on the day of the jump round-trips
    const slot = dst.slotAt(6, 40 + 5 * 44)!
    expect(slot.dayKey).toBe('2026-10-04')
    expect(toZonedInput(slot.iso, TZ)).toBe('2026-10-04T11:00')
    expect(dst.tileTop(slot.iso)!.top).toBe(40 + 5 * 44)
  })

  it('takes a custom range and row height', () => {
    const tall = scheduleWeekGrid({ start: '2026-08-26', tz: TZ, fromHour: 8, toHour: 12, rowPx: 60, headerPx: 0 })
    expect(tall.hours).toEqual([8, 9, 10, 11, 12])
    expect(tall.height).toBe(4 * 60)
    expect(tall.tileTop(at('2026-08-26T09:00'))!.top).toBe(60)
  })
})

/* ── monthCells ─────────────────────────────────────────────────────────── */

describe('monthCells', () => {
  const cells = monthCells('2026-09', TZ)

  it('is a full Monday-first six by seven grid', () => {
    expect(cells).toHaveLength(42)
    expect(cells[0].key).toBe('2026-08-31')
    expect(cells[41].key).toBe('2026-10-11')
  })

  it('flags the days that belong to the month', () => {
    expect(cells[0].inMonth).toBe(false)
    expect(cells.filter(c => c.inMonth)).toHaveLength(30)
    expect(cells.find(c => c.key === '2026-09-01')!.inMonth).toBe(true)
  })

  it('accepts a year and month object too', () => {
    expect(monthCells({ year: 2026, month: 9 }, TZ).map(c => c.key))
      .toEqual(cells.map(c => c.key))
  })

  it('starts a month that begins on a Monday without a leading week', () => {
    const june = monthCells('2026-06', TZ)
    expect(june[0].key).toBe('2026-06-01')
    expect(june[0].inMonth).toBe(true)
  })
})

/* ── canReschedule ──────────────────────────────────────────────────────── */

describe('canReschedule', () => {
  it('moves a post that has not been queued yet', () => {
    for (const status of ['draft', 'pending', 'approved', 'changes']) {
      expect(canReschedule({ status })).toEqual({ ok: true, mode: 'move' })
    }
  })
  it('re-queues a post the provider is already holding', () => {
    expect(canReschedule({ status: 'scheduled' })).toEqual({ ok: true, mode: 'requeue' })
  })
  it('refuses in plain words once the post is done with', () => {
    for (const status of ['published', 'failed', 'cancelled']) {
      const r = canReschedule({ status })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.reason.length).toBeGreaterThan(10)
        expect(r.reason).not.toMatch(/[_A-Z]{4,}/)
      }
    }
    expect(canReschedule({ status: 'published' })).toEqual({
      ok: false, reason: 'This post has already gone out, so it cannot be moved',
    })
  })
  it('treats an unknown status as a draft that can be moved', () => {
    expect(canReschedule({ status: 'wat' })).toEqual({ ok: true, mode: 'move' })
    expect(canReschedule(null)).toEqual({ ok: true, mode: 'move' })
  })
})

/* ── suggestedTimes ─────────────────────────────────────────────────────── */

describe('suggestedTimes', () => {
  const now = at('2026-08-26T08:00') // a Wednesday, 8 am Melbourne

  it('uses the network default when there are no numbers at all', () => {
    const out = suggestedTimes({ analytics: [], network: 'instagram', tz: TZ, now })
    // 7 days, two default slots each — bar the ones already past today
    const days = new Set(out.map(s => s.dayKey))
    expect(days.size).toBe(7)
    expect(out.every(s => s.source === 'default')).toBe(true)
    const times = out.filter(s => s.dayKey === '2026-08-27').map(s => toZonedInput(s.iso, TZ))
    expect(times).toEqual(['2026-08-27T11:00', '2026-08-27T18:30'])
    expect(out[0].why).toMatch(/^Instagram posts often do well around 11 am/)
  })

  it('has a default for every network the owner named', () => {
    const first = (network: string) => {
      const out = suggestedTimes({ analytics: [], network, tz: TZ, now })
      return out.filter(s => s.dayKey === '2026-08-27').map(s => toZonedInput(s.iso, TZ).slice(11))
    }
    expect(first('instagram')).toEqual(['11:00', '18:30'])
    expect(first('tiktok')).toEqual(['12:00', '19:00'])
    expect(first('linkedin')).toEqual(['08:30', '12:30'])
    expect(first('facebook')).toEqual(['12:00', '18:00'])
    expect(first('twitter')).toEqual(['09:00', '17:00'])
    expect(first('youtube')).toEqual(['15:00', '19:00'])
  })

  it('never suggests a time that has already gone', () => {
    const out = suggestedTimes({
      analytics: [], network: 'linkedin', tz: TZ, now: at('2026-08-26T10:00'),
    })
    const today = out.filter(s => s.dayKey === '2026-08-26')
    expect(today.map(s => toZonedInput(s.iso, TZ).slice(11))).toEqual(['12:30'])
    expect(out.every(s => s.iso > now)).toBe(true)
  })

  it('still uses the defaults below the twenty-post floor', () => {
    const analytics = Array.from({ length: 19 }, (_, i) => ({
      platform: 'instagram',
      published_at: at(`2026-08-${String(10 + (i % 10)).padStart(2, '0')}T19:00`),
      likes: 100, comments: 10, shares: 1, saves: 1,
    }))
    const out = suggestedTimes({ analytics, network: 'instagram', tz: TZ, now })
    expect(out.every(s => s.source === 'default')).toBe(true)
  })

  it('learns the client’s own best hours once there are enough posts', () => {
    // 24 posts, every one of them on a Thursday: 20 at 6 pm doing well,
    // 4 at 7 am doing badly
    const analytics = [
      ...Array.from({ length: 20 }, () => ({
        platform: 'instagram', published_at: at('2026-08-20T18:00'),
        likes: 400, comments: 40, shares: 4, saves: 4,
      })),
      ...Array.from({ length: 4 }, () => ({
        platform: 'instagram', published_at: at('2026-08-13T07:00'),
        likes: 1, comments: 0, shares: 0, saves: 0,
      })),
    ]
    const out = suggestedTimes({ analytics, network: 'instagram', tz: TZ, now })
    const thursday = out.filter(s => s.dayKey === '2026-08-27')
    // the slots come out in time order, not best-first — a calendar reads down
    expect(thursday.map(s => s.hour)).toEqual([7, 18])
    expect(thursday[0].source).toBe('yours')
    expect(thursday.find(s => s.hour === 18)!.why)
      .toBe('Your posts get the most reactions around 6 pm on Thursdays')
    // a weekday with no history of its own falls back to the default
    const friday = out.filter(s => s.dayKey === '2026-08-28')
    expect(friday.every(s => s.source === 'default')).toBe(true)
  })

  it('will not trust a weekday×hour bucket with fewer than three results', () => {
    // 20 posts total clears the client-numbers floor, but only 18 of them
    // share an hour — the other 2, alone at 7 am, are a coincidence, not "the
    // client's own numbers", and must not be offered as a learned time
    const analytics = [
      ...Array.from({ length: 18 }, () => ({
        platform: 'instagram', published_at: at('2026-08-20T18:00'),
        likes: 400, comments: 40, shares: 4, saves: 4,
      })),
      ...Array.from({ length: 2 }, () => ({
        platform: 'instagram', published_at: at('2026-08-13T07:00'),
        likes: 500, comments: 50, shares: 5, saves: 5,
      })),
    ]
    const out = suggestedTimes({ analytics, network: 'instagram', tz: TZ, now })
    const thursday = out.filter(s => s.dayKey === '2026-08-27')
    expect(thursday.map(s => s.hour)).not.toContain(7)
    expect(thursday.find(s => s.hour === 18)!.source).toBe('yours')
  })

  it('offers at most three slots on a day', () => {
    const hours = [8, 9, 10, 11, 12, 13]
    const analytics = hours.flatMap((h, i) => Array.from({ length: 4 }, () => ({
      platform: 'instagram',
      published_at: at(`2026-08-20T${String(h).padStart(2, '0')}:00`),
      engagement_rate: (i + 1) / 10,
    })))
    const out = suggestedTimes({ analytics, network: 'instagram', tz: TZ, now })
    const thursday = out.filter(s => s.dayKey === '2026-08-27')
    expect(thursday).toHaveLength(3)
    expect(thursday.map(s => s.hour)).toEqual([11, 12, 13]) // the top three, in time order
  })

  it('ignores numbers older than ninety days and other networks', () => {
    const analytics = [
      ...Array.from({ length: 30 }, () => ({
        platform: 'instagram', published_at: at('2026-01-15T18:00'), likes: 500,
      })),
      ...Array.from({ length: 30 }, () => ({
        platform: 'tiktok', published_at: at('2026-08-20T18:00'), likes: 500,
      })),
    ]
    const out = suggestedTimes({ analytics, network: 'instagram', tz: TZ, now })
    expect(out.every(s => s.source === 'default')).toBe(true)
  })

  it('is sorted and never empty', () => {
    const out = suggestedTimes({ analytics: [], network: 'pinterest', tz: TZ, now })
    expect(out.length).toBeGreaterThan(0)
    expect([...out].sort((a, b) => a.iso.localeCompare(b.iso))).toEqual(out)
  })
})

/* ── slideLimits / applySlideLimit ──────────────────────────────────────── */

describe('slideLimits', () => {
  it('reads the per-kind ceilings off the platform rules', () => {
    expect(slideLimits(['instagram', 'youtube', 'linkedin'])).toEqual({
      instagram: { images: 10, videos: 1, carousel: 10, mixedCarousel: true },
      youtube: { images: 0, videos: 1, carousel: 0, mixedCarousel: false },
      linkedin: { images: 20, videos: 1, carousel: 20, mixedCarousel: false },
    })
  })
  it('skips a platform it has no rules for', () => {
    expect(slideLimits(['instagram', 'myspace'])).toEqual({
      instagram: { images: 10, videos: 1, carousel: 10, mixedCarousel: true },
    })
  })
})

describe('applySlideLimit', () => {
  const many = Array.from({ length: 12 }, (_, i) => img(i))

  it('trims to what the platform will take', () => {
    expect(applySlideLimit(many, 'instagram')).toHaveLength(10)
    expect(applySlideLimit(many, 'youtube')).toHaveLength(0)
    expect(applySlideLimit([vid(1), ...many], 'youtube')).toEqual([vid(1)])
  })

  it('drops the odd one out where a platform will not mix pictures and video', () => {
    expect(applySlideLimit([img(1), vid(2), img(3)], 'tiktok')).toEqual([img(1), img(3)])
    expect(applySlideLimit([vid(1), img(2)], 'tiktok')).toEqual([vid(1)])
  })

  it('caps a leading video at the platform\'s VIDEO ceiling, not its carousel ceiling', () => {
    // TikTok's carousel holds up to 35 photos, but still only one video per
    // post — three videos are not a video carousel, they are three posts
    const threeVideos = [vid(1), vid(2), vid(3)]
    expect(applySlideLimit(threeVideos, 'tiktok')).toEqual([vid(1)])
  })

  it('leaves a mix alone where the platform allows one', () => {
    expect(applySlideLimit([img(1), vid(2)], 'instagram')).toEqual([img(1), vid(2)])
  })

  it('leaves the slides untouched for a platform it does not know', () => {
    expect(applySlideLimit(many, 'myspace')).toEqual(many)
  })
})

/* ── groupForList ───────────────────────────────────────────────────────── */

describe('groupForList', () => {
  const posts = [
    { id: 'c', scheduled_for: at('2026-08-27T18:00') },
    { id: 'a', scheduled_for: at('2026-08-26T09:00') },
    { id: 'b', scheduled_for: at('2026-08-27T07:00') },
    { id: 'd', scheduled_for: null },
  ]

  it('groups by the client’s day and sorts both ways', () => {
    const groups = groupForList(posts, TZ)
    expect(groups.map(g => g.dayKey)).toEqual(['', '2026-08-26', '2026-08-27'])
    expect(groups[0].label).toBe('No time yet')
    expect(groups[0].posts.map(p => p.id)).toEqual(['d'])
    expect(groups[1].label).toBe('Wed 26 Aug')
    expect(groups[2].posts.map(p => p.id)).toEqual(['b', 'c'])
  })

  it('leaves out the no-time group when every post has a time', () => {
    const groups = groupForList(posts.slice(0, 3), TZ)
    expect(groups.map(g => g.dayKey)).toEqual(['2026-08-26', '2026-08-27'])
  })

  it('copes with nothing to show', () => {
    expect(groupForList([], TZ)).toEqual([])
  })
})

/* ── validateComposition ────────────────────────────────────────────────── */

describe('validateComposition', () => {
  const now = at('2026-08-26T08:00')
  const version = { id: 'v1', version_number: 1, files: [img(1), img(2)] }
  const item = { status: 'approved_for_scheduling', content_type: 'carousel' }
  const good = {
    item, version, slides: [img(1), img(2)], caption: 'Two ways to plate it.',
    channels: [{ id: 'a1', platform: 'instagram' }],
    scheduledFor: at('2026-08-27T11:00'), now,
  }

  it('passes a post that is ready', () => {
    expect(validateComposition(good)).toEqual({ ok: true, problems: [] })
  })

  it('refuses a post with no media', () => {
    const r = validateComposition({ ...good, slides: [] })
    expect(r.ok).toBe(false)
    expect(r.problems).toContain('Pick at least one photo or video')
  })

  it('refuses a post with no channel', () => {
    expect(validateComposition({ ...good, channels: [] }).problems)
      .toContain('Choose at least one channel')
  })

  it('refuses a time that has already gone', () => {
    const r = validateComposition({ ...good, scheduledFor: at('2026-08-25T11:00') })
    expect(r.problems).toContain('That time has already gone — pick a later one')
  })

  it('accepts a post with no time yet', () => {
    expect(validateComposition({ ...good, scheduledFor: null }).ok).toBe(true)
  })

  it('asks for words where the channel is built on them', () => {
    const r = validateComposition({
      ...good, caption: '   ', channels: [{ id: 'x1', platform: 'twitter' }],
      slides: [img(1)],
    })
    expect(r.problems).toContain('X needs a caption — write a line to go with the picture')
    // Instagram is happy with a picture and no words
    expect(validateComposition({ ...good, caption: '' }).ok).toBe(true)
  })

  it('counts the media against each channel', () => {
    const r = validateComposition({
      ...good,
      slides: Array.from({ length: 12 }, (_, i) => img(i)),
      channels: [{ id: 'a1', platform: 'instagram' }],
    })
    expect(r.ok).toBe(false)
    expect(r.problems).toContain('Instagram takes 10 media files — take 2 out')
  })

  it('says the true thing when a channel takes video, not pictures', () => {
    const r = validateComposition({
      ...good,
      slides: Array.from({ length: 4 }, (_, i) => img(i)),
      channels: [{ id: 'a1', platform: 'instagram' }, { id: 'y1', platform: 'youtube' }],
    })
    expect(r.ok).toBe(false)
    expect(r.problems).toContain('YouTube takes video, not pictures')
  })

  it('refuses a caption longer than the channel allows', () => {
    const r = validateComposition({
      ...good, caption: 'x'.repeat(281), channels: [{ id: 'x1', platform: 'twitter' }],
    })
    expect(r.problems).toContain('The caption is too long for X — it takes 280 letters, this one is 281')
  })

  it('carries the eligibility reason through', () => {
    const r = validateComposition({ ...good, item: { status: 'client_review' } })
    expect(r.ok).toBe(false)
    expect(r.problems).toContain('Still with the client')
  })

  it('a post whose item is asking for changes cannot be scheduled', () => {
    const r = validateComposition({ ...good, item: { status: 'client_changes_requested' } })
    expect(r.ok).toBe(false)
    expect(r.problems).toContain('Changes in progress')
  })
})
