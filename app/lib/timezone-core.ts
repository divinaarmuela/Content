/**
 * Time zones, done once, in pure functions — no I/O, no dependencies.
 *
 * The agency schedules posts for an audience that lives somewhere; the people
 * doing the scheduling live somewhere else. Melbourne was hard-coded on the
 * assumption that those were the same place, and the moment a scheduler
 * started work from the Philippines it stopped being true: she typed 9:00 into
 * a datetime-local, the browser read it as 9:00 Manila, and the post went out
 * at 11:00 Melbourne.
 *
 * The rule this module exists to enforce has two halves:
 *
 *   1. A POSTING time belongs to the CLIENT's zone. It is a fact about when
 *      the audience sees the post, not about where the reader is sitting. It
 *      is entered, stored (as UTC), and displayed in that zone, with the
 *      abbreviation attached so it can never be mistaken for local time — and
 *      with a "= 1:00 pm your time" hint when the viewer is somewhere else.
 *   2. Anything about the VIEWER — the greeting, "it is now …", a timestamp on
 *      something they did — belongs to the viewer's own zone.
 *
 * Everything here is DST-safe by construction: no fixed offsets are stored or
 * assumed anywhere. `Intl.DateTimeFormat` is the only zone database in play,
 * and the wall-time → instant direction is solved by probing it rather than by
 * arithmetic on an offset that changes twice a year.
 */

/** Where the agency itself sits — the fallback for a client with no zone set. */
export const DEFAULT_TZ = 'Australia/Melbourne'

/** A wall-clock reading: what a clock in some zone shows at some instant. */
export type Wall = {
  year: number; month: number; day: number
  hour: number; minute: number; second: number
}

const cache = new Map<string, Intl.DateTimeFormat>()

/** One formatter per zone, reused — building these is the expensive part. */
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    cache.set(tz, f)
  }
  return f
}

/** Is this a zone the platform actually knows? The "Other…" field's guard. */
export function isValidZone(tz: string | null | undefined): boolean {
  const z = String(tz ?? '').trim()
  if (!z) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z })
    return true
  } catch {
    return false
  }
}

/** A zone we can actually format in — an unknown one degrades to the agency's
 *  rather than throwing halfway down a render. */
export function safeZone(tz: string | null | undefined): string {
  return isValidZone(tz) ? String(tz).trim() : DEFAULT_TZ
}

function toDate(iso: string | number | Date | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === '') return null
  const d = iso instanceof Date ? iso : new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** What a clock in `tz` reads at this instant. */
export function wallTimeIn(iso: string | number | Date, tz: string): Wall | null {
  const d = toDate(iso)
  if (!d) return null
  const parts = partsFormatter(safeZone(tz)).formatToParts(d)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? NaN)
  // hour12:false still renders midnight as "24" in some ICU builds
  const hour = get('hour') % 24
  const wall = {
    year: get('year'), month: get('month'), day: get('day'),
    hour, minute: get('minute'), second: get('second'),
  }
  return Object.values(wall).some(Number.isNaN) ? null : wall
}

/**
 * The zone's offset from UTC at a given INSTANT, in milliseconds.
 *
 * Note the "at a given instant": there is no such thing as "the offset of
 * Melbourne". There is only the offset of Melbourne on 3 August, which is not
 * the offset of Melbourne on 3 December. Every DST bug is this sentence being
 * ignored.
 */
export function zoneOffsetMs(iso: string | number | Date, tz: string): number {
  const d = toDate(iso)
  if (!d) return 0
  const w = wallTimeIn(d, tz)
  if (!w) return 0
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  // milliseconds are not in the parts; they survive the round trip unchanged
  return asIfUtc - (d.getTime() - d.getMilliseconds())
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * ISO instant → the 'YYYY-MM-DDTHH:mm' an `<input type="datetime-local">`
 * wants, showing the CLIENT's wall time rather than the browser's.
 */
export function toZonedInput(iso: string | number | Date | null | undefined, tz: string): string {
  const w = iso === null || iso === undefined ? null : wallTimeIn(iso, tz)
  if (!w) return ''
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/

const TWELVE_HOURS = 12 * 3_600_000

/**
 * The hard direction: a wall time in `tz` → the UTC instant it names.
 *
 * There is no arithmetic that does this in one step, because the offset you
 * need depends on the answer you are trying to compute. Worse, the answer is
 * not always unique: twice a year a wall time either happens twice or does not
 * happen at all, and a scheduler typing "2:30 am" into the box on those two
 * mornings has to get SOMETHING, deterministically.
 *
 * So: pretend the wall time is UTC, collect every offset the zone is plausibly
 * wearing anywhere near it, and turn each one into a candidate instant. A
 * candidate counts only if reading the clock back at that instant gives the
 * wall time we were handed. Then:
 *
 *   • one candidate — the ordinary case, all but two hours of the year;
 *   • two candidates — an ambiguous hour (Melbourne, first Sunday in April,
 *     02:30 happens on AEDT and then again on AEST). Take the EARLIER, which
 *     is what a person reading a calendar means and what every other
 *     scheduling tool does;
 *   • no candidates — a gap (first Sunday in October, 02:30 never happens).
 *     Use the offset from BEFORE the jump, which lands the post an hour later
 *     on the clock. A post booked into an hour that does not exist still goes
 *     out, which is the only acceptable outcome.
 *
 * Returns null for anything that is not a wall time.
 */
export function fromZonedInput(local: string | null | undefined, tz: string): string | null {
  const m = LOCAL_RE.exec(String(local ?? '').trim())
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number)
  const s = m[6] === undefined ? 0 : Number(m[6])
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  const zone = safeZone(tz)
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  if (Number.isNaN(guess)) return null

  // every offset in force within half a day either side of the answer
  const near = guess - zoneOffsetMs(guess, zone)
  const offsets = new Set([
    zoneOffsetMs(guess, zone),
    zoneOffsetMs(near, zone),
    zoneOffsetMs(near - TWELVE_HOURS, zone),
    zoneOffsetMs(near + TWELVE_HOURS, zone),
  ])

  const reads = (ts: number) => {
    const w = wallTimeIn(ts, zone)
    return !!w && w.year === y && w.month === mo && w.day === d
      && w.hour === h && w.minute === mi
  }

  const valid = [...offsets].map(o => guess - o).filter(reads)
  if (valid.length > 0) return new Date(Math.min(...valid)).toISOString()

  // a gap: the smallest offset is the one in force before the clocks jumped
  return new Date(guess - Math.min(...offsets)).toISOString()
}

/**
 * Zone abbreviations, the way a person writes them.
 *
 * ICU only knows the letters for zones the requested locale cares about:
 * en-AU says "AEST" and "GMT-5", en-US says "EST" and "GMT+11". Trying both
 * covers the anglophone world; the map below covers the zones neither locale
 * abbreviates but everybody who lives there does — the scheduler in Manila
 * reads "PHT", not "GMT+8".
 */
const ABBREV: Record<string, { std: string; dst?: string }> = {
  'Asia/Manila': { std: 'PHT' },
  'Asia/Singapore': { std: 'SGT' },
  'Asia/Kuala_Lumpur': { std: 'MYT' },
  'Asia/Jakarta': { std: 'WIB' },
  'Asia/Bangkok': { std: 'ICT' },
  'Asia/Ho_Chi_Minh': { std: 'ICT' },
  'Asia/Hong_Kong': { std: 'HKT' },
  'Asia/Shanghai': { std: 'CST' },
  'Asia/Taipei': { std: 'CST' },
  'Asia/Tokyo': { std: 'JST' },
  'Asia/Seoul': { std: 'KST' },
  'Asia/Kolkata': { std: 'IST' },
  'Asia/Dubai': { std: 'GST' },
  'Europe/London': { std: 'GMT', dst: 'BST' },
  'Europe/Dublin': { std: 'GMT', dst: 'IST' },
}

function icuAbbrev(tz: string, at: Date, locale: string): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(at).find(p => p.type === 'timeZoneName')
    return part?.value ?? ''
  } catch {
    return ''
  }
}

/** Is this zone on its summer offset at this instant? */
function isDst(tz: string, at: Date): boolean {
  const here = zoneOffsetMs(at, tz)
  const jan = zoneOffsetMs(Date.UTC(at.getUTCFullYear(), 0, 15), tz)
  const jul = zoneOffsetMs(Date.UTC(at.getUTCFullYear(), 6, 15), tz)
  return here > Math.min(jan, jul)
}

/** "AEST", "AEDT", "PHT" — the three or four letters that make a printed time
 *  unambiguous. Falls back to "GMT+8" when nothing better exists. */
export function zoneAbbrev(tz: string, iso?: string | number | Date | null): string {
  const zone = safeZone(tz)
  const at = toDate(iso ?? null) ?? new Date()
  for (const locale of ['en-AU', 'en-US']) {
    const v = icuAbbrev(zone, at, locale)
    if (v && !/^(GMT|UTC)[+-]/.test(v)) return v
  }
  const known = ABBREV[zone]
  if (known) return (known.dst && isDst(zone, at)) ? known.dst : known.std
  return icuAbbrev(zone, at, 'en-AU') || 'UTC'
}

/** "Melbourne", "Manila" — the city out of the IANA id, for a label. */
export function zoneLabel(tz: string): string {
  const last = safeZone(tz).split('/').pop() ?? ''
  return last.replace(/_/g, ' ')
}

export type TimeStyle =
  /** "Thu 27 Aug, 3:00 pm" — the default, a whole posting time */
  | 'full'
  /** "27 Aug, 3:00 pm" — no weekday, for a tight table cell */
  | 'short'
  /** "Thu 27 Aug" */
  | 'date'
  /** "3:00 pm" */
  | 'time'
  /** "Thu 27 Aug 2026, 3:00 pm" — history, where the year earns its space */
  | 'long'

function datePart(d: Date, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString('en-AU', { timeZone: tz, ...opts })
    .replace(/,\s*/g, ' ')
    .trim()
}

function timePart(d: Date, tz: string): string {
  return d.toLocaleTimeString('en-AU', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * A time, in a named zone, in the one shape this product uses everywhere.
 *
 * One function so the portal, the queue, the calendar and the emails cannot
 * drift into four different renderings of the same instant — a client and a
 * scheduler comparing screens must be reading the same words.
 */
export function formatInZone(
  iso: string | number | Date | null | undefined,
  tz: string,
  style: TimeStyle = 'full',
): string | null {
  const d = toDate(iso)
  if (!d) return null
  const zone = safeZone(tz)
  switch (style) {
    case 'time':
      return timePart(d, zone)
    case 'date':
      return datePart(d, zone, { weekday: 'short', day: 'numeric', month: 'short' })
    case 'short':
      return `${datePart(d, zone, { day: 'numeric', month: 'short' })}, ${timePart(d, zone)}`
    case 'long':
      return `${datePart(d, zone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${timePart(d, zone)}`
    default:
      return `${datePart(d, zone, { weekday: 'short', day: 'numeric', month: 'short' })}, ${timePart(d, zone)}`
  }
}

/** The same instant with its zone attached: "Thu 27 Aug, 3:00 pm AEST". */
export function formatWithZone(
  iso: string | number | Date | null | undefined,
  tz: string,
  style: TimeStyle = 'full',
): string | null {
  const text = formatInZone(iso, tz, style)
  return text ? `${text} ${zoneAbbrev(tz, iso)}` : null
}

/**
 * "= 1:00 pm your time" — or null when there is nothing to say.
 *
 * Null in two cases, and both matter: the viewer is in the client's zone, or
 * they are in a different zone that happens to read the same on the clock
 * (Brisbane and Sydney in July). Printing "= 3:00 pm your time" under "3:00 pm"
 * is noise that trains people to stop reading the line.
 *
 * When the DAY differs too — Melbourne Monday morning is Sunday night in Los
 * Angeles — the day comes along, because that is the half people get wrong.
 */
export function viewerHint(
  iso: string | number | Date | null | undefined,
  clientTz: string,
  viewerTz: string | null | undefined,
): string | null {
  const d = toDate(iso)
  if (!d || !viewerTz || !isValidZone(viewerTz)) return null
  const client = safeZone(clientTz)
  const viewer = String(viewerTz).trim()
  const a = toZonedInput(d, client)
  const b = toZonedInput(d, viewer)
  if (!a || !b || a === b) return null
  const sameDay = a.slice(0, 10) === b.slice(0, 10)
  return `= ${formatInZone(d, viewer, sameDay ? 'time' : 'short')} your time`
}

/** 'YYYY-MM-DD' in a zone — how a calendar decides which cell a post sits in.
 *  A 9 am Melbourne post is the 27th there and the 26th in London, and the
 *  Melbourne calendar must put it on the 27th. */
export function dayKeyInZone(iso: string | number | Date | null | undefined, tz: string): string | null {
  const w = wallTimeIn(iso ?? '', tz)
  return w ? `${w.year}-${pad(w.month)}-${pad(w.day)}` : null
}

/** Which calendar month an instant falls in, in a zone. The agreement's
 *  "counted in the month it went live" reads this: a post that goes out at
 *  11 pm Melbourne on 31 August is August's delivery, not September's, even
 *  though UTC calls it 1 September. */
export function monthInZone(
  iso: string | number | Date | null | undefined,
  tz: string,
): { month: number; year: number } | null {
  const w = wallTimeIn(iso ?? '', tz)
  return w ? { month: w.month, year: w.year } : null
}

/** The hour of the day a clock in `tz` reads — what a greeting is a function of. */
export function hourInZone(iso: string | number | Date, tz: string): number | null {
  return wallTimeIn(iso, tz)?.hour ?? null
}

export type DayPart = 'late' | 'morning' | 'afternoon' | 'evening' | 'working_late'

/** The bucket, separated from the words so it can be tested as a rule. */
export function dayPart(hour: number): DayPart {
  if (hour < 5) return 'late'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'working_late'
}

export const DAY_PART_GREETING: Record<DayPart, string> = {
  late: 'Still up',
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  working_late: 'Working late',
}

/**
 * How to greet somebody, by their own clock.
 *
 * This is about the VIEWER, so it takes the viewer's zone — the whole bug was
 * a scheduler in Manila being told "Working late" at seven in the evening
 * because the greeting was reading a Melbourne clock nine hundred kilometres
 * of ocean away from her.
 */
export function greetingInZone(iso: string | number | Date, tz: string): string {
  const h = hourInZone(iso, tz)
  return DAY_PART_GREETING[dayPart(h ?? 12)]
}

/**
 * The zones on offer, grouped the way the agency thinks about them: where the
 * clients are, then where the team is. "Other…" in the UI takes any IANA id
 * and validates it with `isValidZone`, so this list never has to be complete.
 */
export const ZONE_GROUPS: { label: string; zones: string[] }[] = [
  {
    label: 'Australia',
    zones: [
      'Australia/Melbourne', 'Australia/Sydney', 'Australia/Brisbane',
      'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart',
      'Australia/Darwin',
    ],
  },
  {
    label: 'Asia',
    zones: [
      'Asia/Manila', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Jakarta',
      'Asia/Bangkok', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul',
      'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai',
    ],
  },
  { label: 'New Zealand', zones: ['Pacific/Auckland'] },
  {
    label: 'United States',
    zones: [
      'America/New_York', 'America/Chicago', 'America/Denver',
      'America/Los_Angeles', 'Pacific/Honolulu',
    ],
  },
  { label: 'United Kingdom', zones: ['Europe/London'] },
]

/** Every zone the grouped picker offers, flat — for "is this one of ours?". */
export const COMMON_ZONES: string[] = ZONE_GROUPS.flatMap(g => g.zones)

/** "Melbourne — AEST" : what a zone reads as in a picker, right now. */
export function zoneOption(tz: string, at?: string | number | Date | null): string {
  return `${zoneLabel(tz)} — ${zoneAbbrev(tz, at ?? null)}`
}
