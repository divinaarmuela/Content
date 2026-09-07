import { ROLE_LABEL, type Role } from './identity-core'

/**
 * HAND A CARD TO SOMEBODY — the pure half.
 *
 * Changing the Who dropdown moves a card silently: the next person finds it
 * in their column with no idea what is wanted of it. Handing it over is a
 * deliberate act with words attached — "cut a 30s version for Reels" — and
 * those words have to end up somewhere the receiver will actually look.
 *
 * The place they look is the card's own "what needs doing" (`brief`), which
 * the board card, the side panel and the job-pack email all print. So the
 * words are APPENDED to it, under a dated line naming who handed it over —
 * never written over what is already there. A brief is the accumulated story
 * of a card; a handover adds a paragraph to it, it does not replace it.
 *
 * No I/O here: the dialog builds the new brief, the PATCH route saves it, and
 * the notification says the same sentence in the bell and the email.
 */

/** The people a card can be handed to, as the picker reads them. */
export type HandTo = { id: string; name: string; email: string; role: string }

/**
 * The order the picker groups people in: the two hats that do the work
 * first, because they are who a card is handed to almost every time, then
 * the people who look after the client.
 */
export const HAND_TO_ROLE_ORDER: readonly Role[] = [
  'editor', 'scheduler', 'account_manager', 'super_admin',
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A date a person reads, out of an ISO stamp — "7 Sep 2026".
 *
 * Deliberately not `toLocaleDateString`: this string is written INTO the card
 * and read by everyone afterwards, so it must not depend on whose browser
 * wrote it. An unreadable stamp yields '' and the line simply carries no date.
 */
export function handoverDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return ''
  return `${Number(m[3])} ${month} ${m[1]}`
}

/** Somebody's name for the words on screen — never an empty label. */
export function personLabel(p: { name?: string | null; email?: string | null } | null | undefined): string {
  return (p?.name || p?.email || 'Someone').trim() || 'Someone'
}

/**
 * The dated line a handover adds to "what needs doing".
 *
 * One line, in the words the person handing over typed, signed and dated so
 * that a brief with three handovers on it still reads in order.
 */
export function handoverLine(by: string, note: string, at?: string | null): string {
  const words = tidyNote(note)
  const when = handoverDate(at)
  const who = (by || '').trim() || 'Someone'
  return `— Handed over by ${who}${when ? `, ${when}` : ''}: ${words}`
}

/** The typed words, trimmed and bounded — never a novel, never a blank line. */
export function tidyNote(note: string | null | undefined): string {
  return String(note ?? '').replace(/\r\n/g, '\n').trim().slice(0, 2000)
}

/**
 * The card's "what needs doing" AFTER a handover: what was there, then a
 * blank line, then the dated line. Nothing is ever removed.
 *
 * No words typed means no change at all — `null` says "do not send `brief`
 * in the PATCH", which is not the same as sending an empty one.
 */
export function briefAfterHandover(
  brief: string | null | undefined, by: string, note: string | null | undefined, at?: string | null,
): string | null {
  const words = tidyNote(note)
  if (!words) return null
  const line = handoverLine(by, words, at)
  const existing = String(brief ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '')
  return existing ? `${existing}\n\n${line}` : line
}

/**
 * What the receiver is told, in one sentence: who, which card, and what they
 * are being asked to do. The bell shows it and the email repeats it.
 */
export function handoverWords(by: string, title: string, note?: string | null): string {
  const who = (by || '').trim() || 'Someone'
  const words = tidyNote(note)
  const head = `${who} handed you “${title}”`
  return words ? `${head} — ${words}` : head
}

/** The subject line of the handover email — the same sentence, bounded. */
export function handoverSubject(by: string, title: string, note?: string | null): string {
  const line = handoverWords(by, title, note)
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}

export type HandToGroup = { role: string; label: string; people: HandTo[] }

/**
 * The picker's people, grouped by what they do and labelled with it, so the
 * person handing over can tell an editor from a scheduler without knowing
 * the team by heart. Clients are never in here — a client never carries a
 * card — and neither is anybody without an id.
 *
 * Roles we do not know about are kept, at the end, under their own name:
 * a person missing from the picker is worse than a heading nobody expected.
 */
export function handToGroups(people: readonly HandTo[]): HandToGroup[] {
  const groups = new Map<string, HandTo[]>()
  for (const p of people) {
    if (!p?.id || p.role === 'client') continue
    const key = p.role || 'other'
    const list = groups.get(key)
    if (list) list.push(p)
    else groups.set(key, [p])
  }
  const order = (role: string) => {
    const i = (HAND_TO_ROLE_ORDER as readonly string[]).indexOf(role)
    return i === -1 ? HAND_TO_ROLE_ORDER.length : i
  }
  return [...groups.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([role, list]) => ({
      role,
      label: (ROLE_LABEL as Record<string, string>)[role] ?? role.split('_').join(' '),
      people: [...list].sort((a, b) => personLabel(a).localeCompare(personLabel(b))),
    }))
}
