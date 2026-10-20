/**
 * REPEATING TO-DOS, AS ASANA DOES THEM (Manal, 20 Oct 2026: "how can you make a task reoccurring when you make a
 * new one? … Can we have it like asana the options that pop up for repeating a task").
 *
 * Asana's own record of Manal's "Releeph UGC Creators" (read 20 Oct 2026, 52 rounds since August) is the model:
 * the rule lives on the task, and ticking it done makes the NEXT task within the second — a new task, due on the
 * next day the rule allows (done Fri 16 Oct → the next one due Mon 19 Oct, weekdays only). Our one-off copy of her
 * Asana tasks on 18 Oct took each repeating task once; ticked here, nothing came after it, and her daily tasks went
 * missing from the dashboard.
 *
 * Pure: the rule, its words and the next date. The route makes the next task (api/todos/[id]).
 */

export const REPEAT_FREQS = ['daily', 'weekly', 'monthly', 'yearly', 'periodically', 'custom'] as const
export type RepeatFreq = (typeof REPEAT_FREQS)[number]
export type RepeatUnit = 'day' | 'week' | 'month' | 'year'

export type TodoRepeat = {
  freq: RepeatFreq
  /** weekly, and custom by weeks: the days it falls on, 0 = Monday … 6 = Sunday (Asana's "On these days"; Manal, 21 Oct
   *  2026: "in custom every … weeks … then you can also choose if needed on these days") */
  days?: number[]
  /** periodically: days after it is DONE; custom: every N `unit` from its due date */
  every?: number
  unit?: RepeatUnit
  /**
   * monthly, and custom by months: the day of the month it falls on — 1 to 28, or 'last' (Manal, 20 Oct 2026, with a
   * video of Asana's "Every 1 Month · On day 20"; Asana's own list stops at 28 then "Last", so it lands every month)
   */
  day?: number | 'last'
  /**
   * monthly, and custom by months, by WEEKDAY instead of date (Manal, 20 Oct 2026, a video of Asana's "Repeats: ○ On
   * the [Last] [Monday] ○ On day [20]": "some clients don't work by dates … the last Monday or first Monday"): the
   * nth (1–4, or 'last') weekday (0 = Monday) of the month. When set it wins over `day`.
   */
  on?: { nth: MonthNth; weekday: number }
}

export type MonthNth = 1 | 2 | 3 | 4 | 'last'
/** Asana's list: First, Second, Third, Fourth, Last */
export const MONTH_NTHS: { key: MonthNth; label: string }[] = [
  { key: 1, label: 'First' }, { key: 2, label: 'Second' }, { key: 3, label: 'Third' }, { key: 4, label: 'Fourth' }, { key: 'last', label: 'Last' },
]
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** Asana's day list: 1–28, then Last */
export const MONTH_DAYS: (number | 'last')[] = [...Array.from({ length: 28 }, (_, i) => i + 1), 'last']

/** The menu, in Asana's order and words */
export const REPEAT_LABEL: Record<RepeatFreq, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', periodically: 'Periodically', custom: 'Custom',
}
export const WEEKDAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const UNITS: RepeatUnit[] = ['day', 'week', 'month', 'year']

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A stored or posted rule, made safe — or null for "doesn't repeat". */
export function normaliseRepeat(raw: unknown): TodoRepeat | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const freq = REPEAT_FREQS.find(f => f === r.freq)
  if (!freq) return null
  const out: TodoRepeat = { freq }
  if (freq === 'weekly') {
    const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    out.days = days.length ? days : [0, 1, 2, 3, 4]
  }
  if (freq === 'periodically' || freq === 'custom') {
    const n = Math.floor(Number(r.every))
    out.every = Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : 1
  }
  if (freq === 'custom') out.unit = UNITS.find(u => u === r.unit) ?? 'week'
  if (freq === 'custom' && out.unit === 'week') {
    // optional here: none means "the same weekday, every N weeks", as before
    const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    if (days.length) out.days = days
  }
  if (freq === 'monthly' || (freq === 'custom' && out.unit === 'month')) {
    const on = r.on as Record<string, unknown> | undefined
    const nth = on && (on.nth === 'last' ? 'last' : [1, 2, 3, 4].find(n => n === Number(on.nth)))
    const wd = on ? Math.floor(Number(on.weekday)) : NaN
    if (nth && Number.isInteger(wd) && wd >= 0 && wd <= 6) out.on = { nth: nth as MonthNth, weekday: wd }
    else if (r.day === 'last') out.day = 'last'
    else {
      const d = Math.floor(Number(r.day))
      if (Number.isFinite(d) && d >= 1 && d <= 28) out.day = d
    }
  }
  return out
}

// dates as plain calendar days, no time zone in the arithmetic
const parse = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)) }
const fmt = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: string, n: number) => { const x = parse(d); x.setUTCDate(x.getUTCDate() + n); return fmt(x) }
/** Monday = 0 */
const weekday = (d: string) => (parse(d).getUTCDay() + 6) % 7
/** n months on, on a chosen day of that month: 1–28, or its last day */
const monthOnDay = (d: string, n: number, day: number | 'last') => {
  const x = parse(d)
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n + 1, 0)).getUTCDate()
  return fmt(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, day === 'last' ? last : Math.min(day, last))))
}
/** n months on, on the nth (or last) given weekday of that month — "the last Monday", "the first Tuesday" */
const monthOnNth = (d: string, n: number, nth: MonthNth, wd: number) => {
  const x = parse(d)
  const y = x.getUTCFullYear(), m = x.getUTCMonth() + n
  if (nth === 'last') {
    const last = new Date(Date.UTC(y, m + 1, 0))
    const back = ((last.getUTCDay() + 6) % 7 - wd + 7) % 7
    last.setUTCDate(last.getUTCDate() - back)
    return fmt(last)
  }
  const first = new Date(Date.UTC(y, m, 1))
  const ahead = (wd - (first.getUTCDay() + 6) % 7 + 7) % 7
  first.setUTCDate(1 + ahead + 7 * (nth - 1))
  return fmt(first)
}
const addMonths = (d: string, n: number) => {
  const x = parse(d)
  const day = x.getUTCDate()
  const first = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(day, last))   // 31 Jan + 1 month = 28/29 Feb, as Asana does
  return fmt(first)
}

/**
 * The next task's due date. Counted from the due date of the one just done (Asana: Fri 16 → Mon 19), or from the
 * day it was done when it had none; "Periodically" always counts from the day it was done.
 */
export function nextDue(repeat: TodoRepeat, due: string | null | undefined, doneOn: string): string {
  const base = due && DATE.test(due) ? due : doneOn
  switch (repeat.freq) {
    case 'daily': return addDays(base, 1)
    case 'weekly': {
      const days = repeat.days?.length ? repeat.days : [weekday(base)]
      for (let i = 1; i <= 7; i++) {
        const d = addDays(base, i)
        if (days.includes(weekday(d))) return d
      }
      return addDays(base, 7)
    }
    case 'monthly': return repeat.on ? monthOnNth(base, 1, repeat.on.nth, repeat.on.weekday) : repeat.day ? monthOnDay(base, 1, repeat.day) : addMonths(base, 1)
    case 'yearly': return addMonths(base, 12)
    case 'periodically': return addDays(doneOn, repeat.every ?? 1)
    case 'custom': {
      const n = repeat.every ?? 1
      const unit = repeat.unit ?? 'week'
      // every N weeks on chosen days: the next chosen day this week, else the first chosen day N weeks on
      if (unit === 'week' && repeat.days?.length) {
        const today = weekday(base)
        const later = repeat.days.filter(d => d > today)
        if (later.length) return addDays(base, later[0] - today)
        return addDays(base, 7 * n - today + repeat.days[0])
      }
      if (unit === 'month' && repeat.on) return monthOnNth(base, n, repeat.on.nth, repeat.on.weekday)
      if (unit === 'month' && repeat.day) return monthOnDay(base, n, repeat.day)
      return unit === 'day' ? addDays(base, n) : unit === 'week' ? addDays(base, 7 * n) : addMonths(base, unit === 'month' ? n : 12 * n)
    }
  }
}

/** "the 20th", "the last day" */
export function dayWords(day: number | 'last'): string {
  if (day === 'last') return 'the last day'
  const s = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'
  return `the ${day}${s}`
}

/** "the last Monday", "the first Tuesday" */
export function nthWords(on: { nth: MonthNth; weekday: number }): string {
  return `the ${MONTH_NTHS.find(n => n.key === on.nth)?.label.toLowerCase() ?? 'first'} ${WEEKDAY_NAMES[on.weekday] ?? 'Monday'}`
}

/** The rule in a few words, for the chip's hover and the picker: "Weekly on Mon–Fri" */
export function repeatWords(repeat: TodoRepeat | null | undefined): string {
  if (!repeat) return "Doesn't repeat"
  switch (repeat.freq) {
    case 'weekly': {
      const days = repeat.days ?? []
      const weekdays = days.length === 5 && [0, 1, 2, 3, 4].every(d => days.includes(d))
      return `Weekly on ${weekdays ? 'Mon–Fri' : days.map(d => WEEKDAY_SHORT[d]).join(', ')}`
    }
    case 'periodically': return `${repeat.every ?? 1} day${(repeat.every ?? 1) === 1 ? '' : 's'} after it's done`
    case 'custom': return `Every ${repeat.every ?? 1} ${repeat.unit ?? 'week'}${(repeat.every ?? 1) === 1 ? '' : 's'}${repeat.unit === 'week' && repeat.days?.length ? ` on ${repeat.days.map(d => WEEKDAY_SHORT[d]).join(', ')}` : repeat.unit === 'month' && repeat.on ? ` on ${nthWords(repeat.on)}` : repeat.unit === 'month' && repeat.day ? ` on ${dayWords(repeat.day)}` : ''}`
    case 'monthly': return `Monthly${repeat.on ? ` on ${nthWords(repeat.on)}` : repeat.day ? ` on ${dayWords(repeat.day)}` : ''}`
    default: return REPEAT_LABEL[repeat.freq]
  }
}

/**
 * The next task's id: one per task, so a double tick or two people at once make it once (claim, trap 11). Fixed
 * length — `<id>_next` grew five characters a round, and a daily task would pass the database's key limit within
 * the year. Two FNV-1a hashes of the id (64 bits) under a `rp_` mark: the same task always names the same next one.
 */
export function nextTodoId(id: string): string {
  const fnv = (s: string, seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
    return h.toString(36).padStart(7, '0')
  }
  return `rp_${fnv(id, 0x811c9dc5)}${fnv(id, 0x9e3779b9)}`
}

/**
 * WHEN IT COMES ROUND AGAIN (Manal, 20 Oct 2026: "I can't see in my calendar when it's gonna pop up next … add a
 * little code for the colour or something so then we know when it will repeat"). The next `count` dates after its
 * due date, each as the rule would set it — for the date picker's marks and the Calendar's faded entries. A task
 * repeated "after it's done" has no date until it is done, so it has none here.
 */
export function upcomingDues(repeat: TodoRepeat | null | undefined, due: string | null | undefined, count = 6): string[] {
  if (!repeat || repeat.freq === 'periodically' || !due || !DATE.test(due)) return []
  const out: string[] = []
  let at = due
  for (let i = 0; i < count; i++) {
    const next = nextDue(repeat, at, at)
    if (!next || next <= at) break
    out.push(next)
    at = next
  }
  return out
}
