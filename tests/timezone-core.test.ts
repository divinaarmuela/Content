import { describe, expect, it } from 'vitest'
import {
  COMMON_ZONES, DEFAULT_TZ, dayKeyInZone, dayPart, formatInZone, formatWithZone,
  fromZonedInput, greetingInZone, hourInZone, isValidZone, monthInZone, safeZone,
  toZonedInput, viewerHint, zoneAbbrev, zoneLabel, zoneOffsetMs,
} from '../app/lib/timezone-core'

const MEL = 'Australia/Melbourne'
const MNL = 'Asia/Manila'
const LON = 'Europe/London'
const LAX = 'America/Los_Angeles'
const BNE = 'Australia/Brisbane'

const HOUR = 3_600_000

describe('isValidZone / safeZone — the "Other…" box has to be able to say no', () => {
  it('accepts real IANA ids and refuses everything else', () => {
    expect(isValidZone(MEL)).toBe(true)
    expect(isValidZone(MNL)).toBe(true)
    expect(isValidZone('UTC')).toBe(true)
    expect(isValidZone('Australia/Melbourn')).toBe(false)
    expect(isValidZone('AEST')).toBe(false)
    expect(isValidZone('')).toBe(false)
    expect(isValidZone(null)).toBe(false)
  })

  it('degrades an unusable zone to the agency’s rather than throwing', () => {
    expect(safeZone(MNL)).toBe(MNL)
    expect(safeZone('nonsense/zone')).toBe(DEFAULT_TZ)
    expect(safeZone(null)).toBe(DEFAULT_TZ)
    // whitespace around a pasted zone is the commonest paste error there is
    expect(safeZone('  Asia/Manila  ')).toBe(MNL)
  })
})

describe('zoneOffsetMs — there is no such thing as "the offset of Melbourne"', () => {
  it('is +10 in winter and +11 in summer', () => {
    expect(zoneOffsetMs('2026-08-15T00:00:00Z', MEL)).toBe(10 * HOUR)
    expect(zoneOffsetMs('2026-01-15T00:00:00Z', MEL)).toBe(11 * HOUR)
  })

  it('never moves for Manila, which has no DST', () => {
    expect(zoneOffsetMs('2026-01-15T00:00:00Z', MNL)).toBe(8 * HOUR)
    expect(zoneOffsetMs('2026-08-15T00:00:00Z', MNL)).toBe(8 * HOUR)
  })

  it('handles a half-hour zone and a negative one', () => {
    expect(zoneOffsetMs('2026-08-15T00:00:00Z', 'Asia/Kolkata')).toBe(5.5 * HOUR)
    expect(zoneOffsetMs('2026-08-15T00:00:00Z', LAX)).toBe(-7 * HOUR)
  })
})

describe('toZonedInput — what the datetime-local box should already be showing', () => {
  it('renders the CLIENT’s wall clock, not the reader’s', () => {
    // 03:00 UTC = 13:00 Melbourne (AEST) = 11:00 Manila
    expect(toZonedInput('2026-08-27T03:00:00.000Z', MEL)).toBe('2026-08-27T13:00')
    expect(toZonedInput('2026-08-27T03:00:00.000Z', MNL)).toBe('2026-08-27T11:00')
  })

  it('crosses the date line the way the zone does', () => {
    // 23:00 UTC on the 26th is already the 27th in Melbourne
    expect(toZonedInput('2026-08-26T23:00:00.000Z', MEL)).toBe('2026-08-27T09:00')
    // …and still the 26th in Los Angeles
    expect(toZonedInput('2026-08-26T23:00:00.000Z', LAX)).toBe('2026-08-26T16:00')
  })

  it('renders midnight as 00:00, never 24:00', () => {
    expect(toZonedInput('2026-08-26T14:00:00.000Z', MEL)).toBe('2026-08-27T00:00')
  })

  it('gives the empty string for nothing at all', () => {
    expect(toZonedInput(null, MEL)).toBe('')
    expect(toZonedInput('', MEL)).toBe('')
    expect(toZonedInput('not a date', MEL)).toBe('')
  })
})

describe('fromZonedInput — the direction no arithmetic gets right', () => {
  it('reads the typed time as the client’s, not the browser’s', () => {
    expect(fromZonedInput('2026-08-27T13:00', MEL)).toBe('2026-08-27T03:00:00.000Z')
    expect(fromZonedInput('2026-08-27T13:00', MNL)).toBe('2026-08-27T05:00:00.000Z')
  })

  it('round-trips through toZonedInput for both zones, all year', () => {
    for (const tz of [MEL, MNL, LON, LAX]) {
      for (const local of [
        '2026-01-15T09:30', '2026-04-05T09:30', '2026-06-30T23:45',
        '2026-10-04T09:30', '2026-12-31T00:00',
      ]) {
        const iso = fromZonedInput(local, tz)
        expect(iso, `${tz} ${local}`).not.toBeNull()
        expect(toZonedInput(iso!, tz), `${tz} ${local}`).toBe(local)
      }
    }
  })

  it('refuses anything that is not a wall time', () => {
    expect(fromZonedInput('', MEL)).toBeNull()
    expect(fromZonedInput(null, MEL)).toBeNull()
    expect(fromZonedInput('27/08/2026 1pm', MEL)).toBeNull()
    expect(fromZonedInput('2026-13-01T10:00', MEL)).toBeNull()
    expect(fromZonedInput('2026-08-27T25:00', MEL)).toBeNull()
  })
})

describe('fromZonedInput across Melbourne’s DST boundaries', () => {
  // Melbourne 2026: clocks go FORWARD 2am→3am on Sun 4 October,
  // and BACK 3am→2am on Sun 5 April.

  it('the day before the spring change is +11? no — +10, and the day after is +11', () => {
    // 3 Oct 2026 10:00 is AEST (+10) → 00:00 UTC
    expect(fromZonedInput('2026-10-03T10:00', MEL)).toBe('2026-10-03T00:00:00.000Z')
    // 5 Oct 2026 10:00 is AEDT (+11) → 23:00 UTC the day before
    expect(fromZonedInput('2026-10-05T10:00', MEL)).toBe('2026-10-04T23:00:00.000Z')
  })

  it('an hour that never existed still books a real instant', () => {
    // 02:30 on 4 Oct does not happen — the clock jumps 2am → 3am.
    const iso = fromZonedInput('2026-10-04T02:30', MEL)
    expect(iso).not.toBeNull()
    // whatever we chose, it is a real instant, and it lands on the far side
    // of the jump rather than silently a day out
    expect(toZonedInput(iso!, MEL).slice(0, 10)).toBe('2026-10-04')
    expect(new Date(iso!).getTime()).toBeGreaterThan(new Date('2026-10-03T12:00:00Z').getTime())
  })

  it('an hour that happened twice picks the first one', () => {
    // 02:30 on 5 April happens once on AEDT (+11) and again on AEST (+10).
    // The earlier instant is the one a person reading a calendar means.
    expect(fromZonedInput('2026-04-05T02:30', MEL)).toBe('2026-04-04T15:30:00.000Z')
    // …and the hour either side is unambiguous
    expect(fromZonedInput('2026-04-05T01:30', MEL)).toBe('2026-04-04T14:30:00.000Z')
    expect(fromZonedInput('2026-04-05T04:30', MEL)).toBe('2026-04-04T18:30:00.000Z')
  })

  it('the same wall times in Manila never move, because Manila never does', () => {
    expect(fromZonedInput('2026-04-05T02:30', MNL)).toBe('2026-04-04T18:30:00.000Z')
    expect(fromZonedInput('2026-10-04T02:30', MNL)).toBe('2026-10-03T18:30:00.000Z')
    expect(fromZonedInput('2026-01-04T02:30', MNL)).toBe('2026-01-03T18:30:00.000Z')
  })
})

describe('zoneAbbrev — the letters that stop a printed time being a guess', () => {
  it('follows Melbourne through the year', () => {
    expect(zoneAbbrev(MEL, '2026-08-27T03:00:00Z')).toBe('AEST')
    expect(zoneAbbrev(MEL, '2026-01-27T03:00:00Z')).toBe('AEDT')
  })

  it('says PHT for Manila, which ICU will not', () => {
    expect(zoneAbbrev(MNL, '2026-08-27T03:00:00Z')).toBe('PHT')
    expect(zoneAbbrev(MNL, '2026-01-27T03:00:00Z')).toBe('PHT')
  })

  it('knows the other zones the picker offers', () => {
    expect(zoneAbbrev('Pacific/Auckland', '2026-08-27T03:00:00Z')).toBe('NZST')
    expect(zoneAbbrev(LAX, '2026-08-27T03:00:00Z')).toBe('PDT')
    expect(zoneAbbrev(LAX, '2026-01-27T03:00:00Z')).toBe('PST')
    expect(zoneAbbrev(LON, '2026-01-27T03:00:00Z')).toBe('GMT')
    expect(zoneAbbrev(LON, '2026-08-27T03:00:00Z')).toBe('BST')
    expect(zoneAbbrev('Asia/Singapore', '2026-08-27T03:00:00Z')).toBe('SGT')
    expect(zoneAbbrev('Asia/Kolkata', '2026-08-27T03:00:00Z')).toBe('IST')
  })

  it('never returns nothing, however odd the zone', () => {
    for (const tz of COMMON_ZONES) {
      expect(zoneAbbrev(tz, '2026-08-27T03:00:00Z')).toMatch(/\S/)
    }
    expect(zoneAbbrev('nonsense/zone')).toBe('AEST')
  })
})

describe('zoneLabel', () => {
  it('is the city, readable', () => {
    expect(zoneLabel(MEL)).toBe('Melbourne')
    expect(zoneLabel(MNL)).toBe('Manila')
    expect(zoneLabel(LAX)).toBe('Los Angeles')
  })
})

describe('formatInZone — one shape everywhere', () => {
  const iso = '2026-08-27T05:00:00.000Z'    // 3:00 pm Melbourne, 1:00 pm Manila

  it('reads the way a person writes a posting time', () => {
    expect(formatInZone(iso, MEL)).toBe('Thu 27 Aug, 3:00 pm')
    expect(formatInZone(iso, MNL)).toBe('Thu 27 Aug, 1:00 pm')
  })

  it('has a shape for each place it is printed', () => {
    expect(formatInZone(iso, MEL, 'time')).toBe('3:00 pm')
    expect(formatInZone(iso, MEL, 'date')).toBe('Thu 27 Aug')
    expect(formatInZone(iso, MEL, 'short')).toBe('27 Aug, 3:00 pm')
    expect(formatInZone(iso, MEL, 'long')).toBe('Thu 27 Aug 2026, 3:00 pm')
  })

  it('renders noon and midnight without the 12/0 confusion', () => {
    expect(formatInZone('2026-08-27T02:00:00Z', MEL, 'time')).toBe('12:00 pm')
    expect(formatInZone('2026-08-26T14:00:00Z', MEL, 'time')).toBe('12:00 am')
  })

  it('attaches the zone when the reader needs it', () => {
    expect(formatWithZone(iso, MEL)).toBe('Thu 27 Aug, 3:00 pm AEST')
    expect(formatWithZone(iso, MNL)).toBe('Thu 27 Aug, 1:00 pm PHT')
    expect(formatWithZone('2026-01-27T05:00:00Z', MEL, 'time')).toBe('4:00 pm AEDT')
  })

  it('says nothing about a time that is not there', () => {
    expect(formatInZone(null, MEL)).toBeNull()
    expect(formatInZone('', MEL)).toBeNull()
    expect(formatInZone('not a date', MEL)).toBeNull()
    expect(formatWithZone(null, MEL)).toBeNull()
  })
})

describe('viewerHint — "= 1:00 pm your time"', () => {
  const iso = '2026-08-27T05:00:00.000Z'

  it('translates a Melbourne posting time for a scheduler in Manila', () => {
    expect(viewerHint(iso, MEL, MNL)).toBe('= 1:00 pm your time')
  })

  it('stays silent when the viewer is in the client’s zone', () => {
    expect(viewerHint(iso, MEL, MEL)).toBeNull()
  })

  it('stays silent when two different zones read the same clock', () => {
    // Brisbane never moves; in August it and Melbourne are both +10
    expect(viewerHint(iso, MEL, BNE)).toBeNull()
    // …but in January Melbourne is on summer time and they part company
    expect(viewerHint('2026-01-27T05:00:00Z', MEL, BNE)).toBe('= 3:00 pm your time')
  })

  it('brings the day along when the day is what differs', () => {
    // 9 am Thursday in Melbourne is Wednesday afternoon in Los Angeles
    expect(viewerHint('2026-08-26T23:00:00Z', MEL, LAX)).toBe('= 26 Aug, 4:00 pm your time')
  })

  it('says nothing rather than guessing when the viewer’s zone is unknown', () => {
    expect(viewerHint(iso, MEL, null)).toBeNull()
    expect(viewerHint(iso, MEL, '')).toBeNull()
    expect(viewerHint(iso, MEL, 'nonsense/zone')).toBeNull()
    expect(viewerHint(null, MEL, MNL)).toBeNull()
  })
})

describe('dayKeyInZone — which calendar cell a post belongs in', () => {
  it('is the client’s date, not UTC’s', () => {
    expect(dayKeyInZone('2026-08-26T23:00:00Z', MEL)).toBe('2026-08-27')
    expect(dayKeyInZone('2026-08-26T23:00:00Z', LON)).toBe('2026-08-27')
    expect(dayKeyInZone('2026-08-26T23:00:00Z', LAX)).toBe('2026-08-26')
  })

  it('is null for a post with no time', () => {
    expect(dayKeyInZone(null, MEL)).toBeNull()
    expect(dayKeyInZone('nope', MEL)).toBeNull()
  })
})

describe('monthInZone — the agreement’s "counted in the month it went live"', () => {
  it('keeps a late-night 31 August post in August', () => {
    // 23:00 Melbourne on 31 Aug is already 1 Sep in UTC — and still August's
    // delivery for the client who was promised it
    expect(monthInZone('2026-08-31T13:00:00Z', MEL)).toEqual({ month: 8, year: 2026 })
    expect(monthInZone('2026-08-31T13:00:00Z', 'UTC')).toEqual({ month: 8, year: 2026 })
    expect(monthInZone('2026-08-31T23:00:00Z', MEL)).toEqual({ month: 9, year: 2026 })
  })

  it('rolls the year over in the client’s zone', () => {
    // 31 Dec 2026 23:00 UTC is already 1 Jan 2027 in Melbourne
    expect(monthInZone('2026-12-31T23:00:00Z', MEL)).toEqual({ month: 1, year: 2027 })
    expect(monthInZone('2026-12-31T23:00:00Z', MNL)).toEqual({ month: 1, year: 2027 })
    expect(monthInZone('2026-12-31T23:00:00Z', LAX)).toEqual({ month: 12, year: 2026 })
  })

  it('is null for nothing', () => {
    expect(monthInZone(null, MEL)).toBeNull()
  })
})

describe('the greeting is about the VIEWER, so it is read off the viewer’s clock', () => {
  it('buckets the day', () => {
    expect(dayPart(0)).toBe('late')
    expect(dayPart(4)).toBe('late')
    expect(dayPart(5)).toBe('morning')
    expect(dayPart(11)).toBe('morning')
    expect(dayPart(12)).toBe('afternoon')
    expect(dayPart(16)).toBe('afternoon')
    expect(dayPart(17)).toBe('evening')
    expect(dayPart(20)).toBe('evening')
    expect(dayPart(21)).toBe('working_late')
    expect(dayPart(23)).toBe('working_late')
  })

  it('reads the hour in the zone it was given', () => {
    // 11:02 UTC on 24 Aug 2026 = 21:02 Melbourne = 19:02 Manila
    expect(hourInZone('2026-08-24T11:02:00Z', MEL)).toBe(21)
    expect(hourInZone('2026-08-24T11:02:00Z', MNL)).toBe(19)
  })

  it('is the exact screenshot: Melbourne said "Working late" to somebody having dinner in Manila', () => {
    expect(greetingInZone('2026-08-24T11:02:00Z', MEL)).toBe('Working late')
    expect(greetingInZone('2026-08-24T11:02:00Z', MNL)).toBe('Good evening')
  })

  it('greets each part of the day, in each zone', () => {
    // 2026-08-24T00:30Z = 10:30 Melbourne = 08:30 Manila
    expect(greetingInZone('2026-08-24T00:30:00Z', MEL)).toBe('Good morning')
    expect(greetingInZone('2026-08-24T00:30:00Z', MNL)).toBe('Good morning')
    // 2026-08-24T05:00Z = 15:00 Melbourne = 13:00 Manila
    expect(greetingInZone('2026-08-24T05:00:00Z', MEL)).toBe('Good afternoon')
    expect(greetingInZone('2026-08-24T05:00:00Z', MNL)).toBe('Good afternoon')
    // 2026-08-23T17:00Z = 03:00 Melbourne (next day) = 01:00 Manila
    expect(greetingInZone('2026-08-23T17:00:00Z', MEL)).toBe('Still up')
    expect(greetingInZone('2026-08-23T17:00:00Z', MNL)).toBe('Still up')
  })

  it('falls back to a neutral hour rather than lying about an unusable zone', () => {
    expect(greetingInZone('2026-08-24T11:02:00Z', 'nonsense/zone')).toBe('Working late')
  })
})
