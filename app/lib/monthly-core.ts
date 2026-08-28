/**
 * Pure monthly-update helpers — no imports beyond a type, no I/O, fully
 * unit-testable.
 *
 * The monthly form REUSES the intake block model wholesale (Block / Section /
 * TemplateDefinition / Answers, mergeAnswers, completion, nextStatus, etc. all
 * live in intake-core and are imported directly). The only logic unique to the
 * monthly form is the (month, year) a form is FOR — validating it, defaulting
 * it to the current month, and turning it into a human title. That is all that
 * lives here.
 */

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export type MonthYear = { month: number; year: number }

/** A month coerced to 1–12, or null when it is not a usable month. Accepts a
 *  number or a numeric string, so a value straight off a <select> is fine. */
export function normaliseMonth(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isInteger(n) || n < 1 || n > 12) return null
  return n
}

/** A year coerced to a sane calendar range (2000–2100), or null. The bound is
 *  the same as the SQL check, so a value the app accepts is one the table will
 *  also store. */
export function normaliseYear(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return null
  return n
}

/** The month a new form defaults to: the one we are in now. */
export function currentMonthYear(now: Date = new Date()): MonthYear {
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

/** "September 2026" — the month named for a human. Falls back gracefully rather
 *  than printing "undefined" if a stored row is somehow out of range. */
export function monthLabel(month: number, year: number): string {
  const name = MONTH_NAMES[(normaliseMonth(month) ?? 1) - 1]
  return `${name} ${normaliseYear(year) ?? year}`
}

/** The default title for a new form: "Monthly update — September 2026". */
export function monthlyTitle(month: number, year: number): string {
  return `Monthly update — ${monthLabel(month, year)}`
}
