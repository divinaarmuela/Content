import { describe, expect, it } from 'vitest'
import {
  openSlots, minToLabel, labelToMin, zonedToUtc, utcToZoned, weekdayOf, parseServiceCopy, serviceTeaser, seatsLeft, policyFor, isUsablePhone,
} from '../app/lib/booking-core'

describe('openSlots', () => {
  it('tiles a window by duration and drops taken + past slots', () => {
    // 9:00–11:00 (540–660), 30-min service
    const slots = openSlots({
      windows: [{ start_min: 540, end_min: 660 }],
      durationMin: 30,
      taken: [{ start_min: 600, end_min: 630 }],  // 10:00–10:30 taken
      nowMin: 555,                // it's 9:15 → 9:00 slot is gone
    })
    // candidates 540,570,600,630 → drop 540 (past), 600 (taken) → 570,630
    expect(slots).toEqual([570, 630])
  })

  it('a slot must fit fully inside the window', () => {
    // 9:00–9:50, 30-min: only 9:00 and 9:20... 9:20+30=9:50 fits; 9:30 would end 10:00 > window
    const slots = openSlots({ windows: [{ start_min: 540, end_min: 590 }], durationMin: 30, stepMin: 20, taken: [] })
    expect(slots).toEqual([540, 560])
  })

  it('merges multiple windows and dedupes/sorts', () => {
    const slots = openSlots({
      windows: [{ start_min: 600, end_min: 660 }, { start_min: 540, end_min: 600 }],
      durationMin: 60, taken: [],
    })
    expect(slots).toEqual([540, 600])
  })

  it('rejects bad rows and zero/negative durations', () => {
    expect(openSlots({ windows: [{ start_min: 660, end_min: 540 }], durationMin: 30, taken: [] })).toEqual([])
    expect(openSlots({ windows: [{ start_min: 540, end_min: 660 }], durationMin: 0, taken: [] })).toEqual([])
  })
})

describe('minToLabel / labelToMin round-trip', () => {
  it('formats and parses', () => {
    expect(minToLabel(570)).toBe('9:30 am')
    expect(minToLabel(0)).toBe('12:00 am')
    expect(minToLabel(720)).toBe('12:00 pm')
    expect(minToLabel(1350)).toBe('10:30 pm')
    expect(labelToMin('9:30 am')).toBe(570)
    expect(labelToMin('12:00 pm')).toBe(720)
    expect(labelToMin('10:30 pm')).toBe(1350)
    expect(labelToMin('nonsense')).toBeNull()
  })
})

describe('timezone conversion — the DST trap', () => {
  const MEL = 'Australia/Melbourne'

  it('winter (AEST, UTC+10): 9am Melbourne is 23:00 UTC the day before', () => {
    const d = zonedToUtc('2026-06-15', 9 * 60, MEL)!
    expect(d.toISOString()).toBe('2026-06-14T23:00:00.000Z')
  })

  it('summer (AEDT, UTC+11): the same 9am is 22:00 UTC', () => {
    const d = zonedToUtc('2026-12-15', 9 * 60, MEL)!
    expect(d.toISOString()).toBe('2026-12-14T22:00:00.000Z')
  })

  it('a fixed offset would be an hour out — the two differ by exactly 1h', () => {
    const winter = zonedToUtc('2026-06-15', 9 * 60, MEL)!
    const summer = zonedToUtc('2026-12-15', 9 * 60, MEL)!
    const winterUtcHour = winter.getUTCHours()
    const summerUtcHour = summer.getUTCHours()
    expect((winterUtcHour - summerUtcHour + 24) % 24).toBe(1)
  })

  it('round-trips a local time back to itself', () => {
    for (const day of ['2026-06-15', '2026-12-15', '2026-10-04', '2026-04-05']) {
      const utc = zonedToUtc(day, 14 * 60 + 30, MEL)!
      const back = utcToZoned(utc, MEL)
      expect(`${day} ${back.minutes}`).toBe(`${day} ${14 * 60 + 30}`)
    }
  })

  it('handles the changeover days themselves', () => {
    // DST ends 5 Apr 2026 (clocks back), starts 4 Oct 2026 (clocks forward).
    // 10am on each is unambiguous and must survive the round trip.
    for (const day of ['2026-04-05', '2026-10-04']) {
      const utc = zonedToUtc(day, 10 * 60, MEL)!
      expect(utcToZoned(utc, MEL)).toEqual({ day, minutes: 600 })
    }
  })

  it('rejects a malformed day instead of inventing one', () => {
    expect(zonedToUtc('not-a-day', 540, MEL)).toBeNull()
    expect(weekdayOf('2026-13-99')).toBeNull()
  })

  it('weekdayOf matches the calendar', () => {
    expect(weekdayOf('2026-08-24')).toBe(1) // a Monday
    expect(weekdayOf('2026-08-23')).toBe(0) // Sunday
  })
})

describe('parseServiceCopy — the real MD House listing', () => {
  const copy = `WHATS INCLUDED:

- Multi-cam video setup (Sony FX3 & Sony FX6 Cameras)
- Dedicated team to manage the session
- Photos & B-Roll videos
- Up to 4x Shure SM7B Mics

WHAT YOU RECEIVE:

- RAW Synced episode
- 24 Hour turnaround

OPTIONAL ADD ONS:

- Social Media Clips`

  it('turns the listing into headings and bullet lists', () => {
    const blocks = parseServiceCopy(copy)
    const headings = blocks.filter(b => b.kind === 'heading').map(b => (b as { text: string }).text)
    expect(headings).toEqual(['WHATS INCLUDED', 'WHAT YOU RECEIVE', 'OPTIONAL ADD ONS'])
    const lists = blocks.filter(b => b.kind === 'bullets') as { items: string[] }[]
    expect(lists).toHaveLength(3)
    expect(lists[0].items[0]).toBe('Multi-cam video setup (Sony FX3 & Sony FX6 Cameras)')
    expect(lists[2].items).toEqual(['Social Media Clips'])
  })

  it('keeps ordinary prose as prose', () => {
    const blocks = parseServiceCopy('Ideal for brands, creators, and campaigns with support.')
    expect(blocks).toEqual([{ kind: 'text', text: 'Ideal for brands, creators, and campaigns with support.' }])
  })

  it('does not mistake a normal sentence for a heading', () => {
    const blocks = parseServiceCopy('The 8 hours include bump in and bump out time.')
    expect(blocks[0].kind).toBe('text')
  })

  it('is safe on empty or missing copy', () => {
    expect(parseServiceCopy(null)).toEqual([])
    expect(parseServiceCopy('')).toEqual([])
    expect(parseServiceCopy('   \n\n  ')).toEqual([])
  })
})

describe('serviceTeaser — one line for a list, not the whole brochure', () => {
  const podcast = `WHATS INCLUDED:

- Multi-cam video setup (Sony FX3 & Sony FX6 Cameras)
- Dedicated team to manage the session

WHAT YOU RECEIVE:

- RAW Synced episode`

  it('uses the first inclusions when there is no prose', () => {
    expect(serviceTeaser(podcast))
      .toBe('Multi-cam video setup (Sony FX3 & Sony FX6 Cameras) · Dedicated team to manage the session')
  })

  it('prefers real prose over bullets', () => {
    expect(serviceTeaser('Ideal for brands, creators, and campaigns with support.\n\n- bump in included'))
      .toBe('Ideal for brands, creators, and campaigns with support.')
  })

  it('never returns a bare heading', () => {
    expect(serviceTeaser('WHATS INCLUDED:')).toBe('')
  })

  it('truncates on a word boundary', () => {
    const long = 'a'.repeat(10) + ' ' + 'word '.repeat(60)
    const t = serviceTeaser(long, 50)
    expect(t.length).toBeLessThanOrEqual(51)
    expect(t.endsWith('…')).toBe(true)
    expect(t).not.toMatch(/\s…$/)
  })

  it('is safe on nothing', () => {
    expect(serviceTeaser(null)).toBe('')
    expect(serviceTeaser('')).toBe('')
  })
})

describe('seats — an event holds more than one person', () => {
  const day = { windows: [{ start_min: 1080, end_min: 1200 }], durationMin: 120 } // 18:00–20:00
  const seat = (start: number) => ({ start_min: start, end_min: start + 120 })

  it('a private booking (capacity 1) closes as soon as it is taken', () => {
    expect(openSlots({ ...day, taken: [] })).toEqual([1080])
    expect(openSlots({ ...day, taken: [seat(1080)] })).toEqual([])
  })

  it('an event stays open until every seat is gone', () => {
    const taken = [seat(1080), seat(1080), seat(1080)]
    expect(openSlots({ ...day, capacity: 5, taken })).toEqual([1080])
    expect(openSlots({ ...day, capacity: 3, taken })).toEqual([])
  })

  it('counts each booking as its own seat', () => {
    expect(seatsLeft([seat(1080), seat(1080), seat(1080)], 1080, 120, 20)).toBe(17)
    expect(seatsLeft([seat(1080)], 1080, 120, 1)).toBe(0)
    expect(seatsLeft([], 1080, 120, 20)).toBe(20)
  })

  it('never reports negative seats if something oversold', () => {
    expect(seatsLeft([seat(1080), seat(1080), seat(1080)], 1080, 120, 2)).toBe(0)
  })

  it('seats at one time do not consume another time', () => {
    const twoSlots = { windows: [{ start_min: 540, end_min: 780 }], durationMin: 120 }
    expect(openSlots({ ...twoSlots, capacity: 2, taken: [seat(540), seat(540)] })).toEqual([660])
  })
})

describe('overlapping durations — the double-booking hole', () => {
  const openAllDay = { windows: [{ start_min: 540, end_min: 1020 }] }   // 9:00–17:00

  it('a 2-hour session blocks every hour it actually runs through', () => {
    // booked 10:00–12:00; 11:00 sits INSIDE it and must not be offered
    const free = openSlots({ ...openAllDay, durationMin: 60, taken: [{ start_min: 600, end_min: 720 }] })
    expect(free).not.toContain(660)   // 11:00
    expect(free).not.toContain(600)   // 10:00
    expect(free).toContain(540)       // 9:00 is still fine
    expect(free).toContain(720)       // 12:00, the moment it ends, is free
  })

  it('a short booking blocks a long session that would swallow it', () => {
    // a 1-hour booking at 11:00–12:00 must stop a 2-hour session that would
    // run 11:00–13:00 straight through it
    const free = openSlots({ ...openAllDay, durationMin: 120, taken: [{ start_min: 660, end_min: 720 }] })
    expect(free).not.toContain(660)
    expect(free).toContain(540)   // 9:00–11:00 ends as the booking starts
    expect(free).toContain(780)   // 13:00 is clear
  })

  it('back-to-back is allowed — half-open, not touching', () => {
    const free = openSlots({ ...openAllDay, durationMin: 60, taken: [{ start_min: 540, end_min: 600 }] })
    expect(free).toContain(600)       // starts exactly as the other ends
  })

  it('ignores a malformed span rather than blocking the whole day', () => {
    const free = openSlots({ ...openAllDay, durationMin: 60, taken: [{ start_min: 600, end_min: 600 }] })
    expect(free).toContain(600)
  })
})

describe('policyFor — the cancellation windows', () => {
  const at = (hoursAway: number) => new Date(Date.now() + hoursAway * 3_600_000)

  it('more than 24h away: free reschedule, full refund', () => {
    const p = policyFor(at(48))
    expect(p).toMatchObject({ canReschedule: true, canCancel: true, refundPercent: 100 })
  })

  it('exactly on the 24h boundary still counts as free', () => {
    expect(policyFor(at(24.001)).refundPercent).toBe(100)
  })

  it('between 2h and 24h: no self-reschedule, 80% back', () => {
    const p = policyFor(at(6))
    expect(p).toMatchObject({ canReschedule: false, canCancel: true, refundPercent: 80 })
  })

  it('under 2 hours: nothing changeable, nothing refunded', () => {
    const p = policyFor(at(1))
    expect(p).toMatchObject({ canReschedule: false, canCancel: false, refundPercent: 0 })
  })

  it('already happened: locked', () => {
    const p = policyFor(at(-1))
    expect(p.canCancel).toBe(false)
    expect(p.reason).toMatch(/already taken place/)
  })

  it('a nonsense date never silently allows a refund', () => {
    expect(policyFor('not-a-date').refundPercent).toBe(0)
  })
})

describe('isUsablePhone', () => {
  it('accepts how Australians actually write numbers', () => {
    for (const p of ['0412 345 678', '+61 412 345 678', '(03) 9123 4567', '03-9123-4567', '0391234567']) {
      expect(isUsablePhone(p)).toBe(true)
    }
  })
  it('rejects too short, too long, and obvious placeholders', () => {
    for (const p of ['', '12345', '1234567', '0000000000', '1111111111', '1'.repeat(20)]) {
      expect(isUsablePhone(p)).toBe(false)
    }
  })
  it('rejects nothing at all', () => {
    expect(isUsablePhone(null)).toBe(false)
    expect(isUsablePhone(undefined)).toBe(false)
  })
})
