import { describe, expect, it } from 'vitest'
import { dayKeyOfUtc, rangeLabel, shiftDays } from '@/app/dashboard/social/schedule/week-nav'
import { filterMedia, RAIL_FILTERS, type RailFilter } from '@/app/dashboard/social/schedule/MediaRail'
import { initialsOf, VIEWS } from '@/app/dashboard/social/schedule/ProfilesBar'
import { STATUS_WORDS } from '@/app/dashboard/social/schedule/tiles'
import { SOCIAL_POST_STATUSES, tileTone } from '@/app/lib/social-schedule-core'
import type { RailMedia } from '@/app/dashboard/social/schedule/useSchedulePosts'

/**
 * The Schedule page's own decisions — the ones that are rules rather than
 * pixels: which week you are looking at, what the rail's filters mean, and
 * that every status a post can be in has words for a person.
 *
 * The grid maths itself is `social-schedule-core` and is tested there; this
 * file only pins what the page adds on top of it.
 */

describe('paging through weeks', () => {
  it('steps seven days on a plain week', () => {
    expect(shiftDays('2026-09-07', 7)).toBe('2026-09-14')
    expect(shiftDays('2026-09-07', -7)).toBe('2026-08-31')
  })

  it('steps seven days across the weekend the clocks change', () => {
    // Melbourne's DST start, 2026-10-04: a week is still seven days because
    // the key is stepped in UTC, never by adding hours to an instant
    expect(shiftDays('2026-09-28', 7)).toBe('2026-10-05')
  })

  it('leaves a key it cannot read alone rather than inventing a date', () => {
    expect(shiftDays('not-a-day', 7)).toBe('not-a-day')
  })

  it('names a day from a UTC instant', () => {
    expect(dayKeyOfUtc(Date.UTC(2026, 8, 7))).toBe('2026-09-07')
  })
})

describe('the week on screen has a name', () => {
  const week = (from: [number, number, number], to: [number, number, number]) => [
    { year: from[0], month: from[1], day: from[2] },
    { year: to[0], month: to[1], day: to[2] },
  ]

  it('says the month once when the week sits inside one', () => {
    expect(rangeLabel(week([2026, 9, 7], [2026, 9, 13]))).toBe('7 – 13 September 2026')
  })

  it('says both months when the week crosses one', () => {
    expect(rangeLabel(week([2026, 8, 31], [2026, 9, 6]))).toBe('31 August – 6 September 2026')
  })

  it('says both years at new year', () => {
    expect(rangeLabel(week([2026, 12, 28], [2027, 1, 3])))
      .toBe('28 December 2026 – 3 January 2027')
  })

  it('says nothing rather than half a range with no days', () => {
    expect(rangeLabel([])).toBe('')
  })
})

describe('the media rail filters', () => {
  const media = (over: Partial<RailMedia>): RailMedia => ({
    itemId: 'i1', title: 'A piece', contentType: 'static',
    slides: [], cover: { url: 'u', name: 'n', type: 'image' },
    ok: true, reason: null, used: false, updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  })
  const photo = media({ itemId: 'photo' })
  const video = media({ itemId: 'video', cover: { url: 'u', name: 'n', type: 'video' } })
  const usedPhoto = media({ itemId: 'used', used: true })
  const all = [photo, video, usedPhoto]
  const filters = (...f: RailFilter[]) => new Set<RailFilter>(f)

  it('shows everything when nothing is chosen', () => {
    expect(filterMedia(all, filters(), new Set())).toHaveLength(3)
  })

  it('"Unused" drops what a post already uses — one post, one item', () => {
    expect(filterMedia(all, filters('Unused'), new Set()).map(m => m.itemId))
      .toEqual(['photo', 'video'])
  })

  it('"Photos" and "Videos" each keep their own kind', () => {
    expect(filterMedia(all, filters('Photos'), new Set()).map(m => m.itemId))
      .toEqual(['photo', 'used'])
    expect(filterMedia(all, filters('Videos'), new Set()).map(m => m.itemId))
      .toEqual(['video'])
  })

  it('choosing both kinds means both, not neither', () => {
    expect(filterMedia(all, filters('Photos', 'Videos'), new Set())).toHaveLength(3)
  })

  it('"Starred" is this person\'s own shortlist', () => {
    expect(filterMedia(all, filters('Starred'), new Set(['video'])).map(m => m.itemId))
      .toEqual(['video'])
  })

  it('combines with the others rather than replacing them', () => {
    expect(filterMedia(all, filters('Starred', 'Unused'), new Set(['used', 'photo']))
      .map(m => m.itemId)).toEqual(['photo'])
  })

  it('offers exactly the four filters the design named', () => {
    expect([...RAIL_FILTERS]).toEqual(['Unused', 'Videos', 'Photos', 'Starred'])
  })
})

describe('what a person is told', () => {
  it('gives every status a post can be in plain words', () => {
    for (const status of SOCIAL_POST_STATUSES) {
      expect(STATUS_WORDS[status], status).toBeTruthy()
      expect(STATUS_WORDS[status], status).not.toMatch(/_/)
    }
  })

  it('never says "graphic" — a video is not a graphic', () => {
    for (const status of SOCIAL_POST_STATUSES) {
      expect(STATUS_WORDS[status].toLowerCase()).not.toContain('graphic')
    }
  })

  it('has a tone for every status, so no tile is drawn colourless by accident', () => {
    for (const status of SOCIAL_POST_STATUSES) {
      expect(tileTone(status), status).toBeTruthy()
    }
    // cancelled is deliberately quiet: it is history, not work
    expect(tileTone('cancelled')).toBe('muted')
  })

  it('offers the five views the design named, week among them', () => {
    expect([...VIEWS]).toEqual(['Stories', 'Preview', 'Week', 'Month', 'List'])
  })

  it('shortens a name to two letters for an avatar', () => {
    expect(initialsOf('Sui Kitchen')).toBe('SK')
    expect(initialsOf('  divina ')).toBe('D')
    expect(initialsOf('')).toBe('—')
  })
})
