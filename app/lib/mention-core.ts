/**
 * "@Name" in a comment — pure, no I/O.
 *
 * Tagging somebody is how a note reaches the person doing the work: the
 * tagged person gets the email, the notification, the "Waiting on you" card
 * and the badge on their board card. Until now the only way to tag was a
 * dropdown that managers saw and nobody else did. Typing "@" is what everyone
 * already does in every other tool, so that is the way in here — and because
 * the words a person types are the source of truth, the parser lives in one
 * pure module the route and the box both call.
 *
 * Matching is by display name, longest name first, case-insensitive, so
 * "@Manal Doe" beats "@Manal" when both are on the team, and "@manal" still
 * finds Manal. A name has to be followed by a word boundary: "@Manalx" tags
 * nobody rather than guessing.
 */

export type Mentionable = { id: string; name: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Members whose "@Name" appears in the text, in order of first appearance,
 *  each once. Members with blank names can never be tagged. */
export function extractMentions(text: string, members: readonly Mentionable[]): Mentionable[] {
  const usable = members.filter(m => m.name.trim().length > 0)
  if (!usable.length || !text.includes('@')) return []
  // longest first so a full name wins over a first name it contains
  const sorted = [...usable].sort((a, b) => b.name.length - a.name.length)
  const found: { at: number; m: Mentionable }[] = []
  const taken: [number, number][] = []
  for (const m of sorted) {
    const re = new RegExp(`(^|[^\\w])@${escapeRe(m.name.trim())}(?![\\w])`, 'gi')
    let hit: RegExpExecArray | null
    while ((hit = re.exec(text)) !== null) {
      const start = hit.index + hit[1].length
      const end = start + 1 + m.name.trim().length
      // a span already claimed by a longer name is not a second mention
      if (taken.some(([s, e]) => start < e && end > s)) continue
      taken.push([start, end])
      if (!found.some(f => f.m.id === m.id)) found.push({ at: start, m })
    }
  }
  return found.sort((a, b) => a.at - b.at).map(f => f.m)
}

/**
 * Is the caret inside an "@…" the person is still typing? Returns where the
 * "@" is and what has been typed after it, so a picker can filter on it.
 * Null once there is a space after a completed name, or no "@" at all.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  // "@" has to start a word — an email address is not a mention
  if (at > 0 && /\w/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  // one space inside is allowed (a first and last name); a second means the
  // person has moved on to the rest of the sentence
  if (/\n/.test(query) || (query.match(/ /g) ?? []).length > 1) return null
  if (query.endsWith(' ') && query.trim().length === 0) return null
  return { start: at, query }
}

/** The members a picker should offer for what has been typed so far. */
export function filterMentionable(members: Mentionable[], query: string, limit = 6): Mentionable[] {
  const q = query.trim().toLowerCase()
  const usable = members.filter(m => m.name.trim().length > 0)
  const ranked = usable
    .map(m => {
      const n = m.name.toLowerCase()
      const rank = q === '' ? 1 : n.startsWith(q) ? 0 : n.split(/\s+/).some(w => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : -1
      return { m, rank }
    })
    .filter(r => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.m.name.localeCompare(b.m.name))
  return ranked.slice(0, limit).map(r => r.m)
}

/**
 * Who a comment tags, settled once for the box and the server alike: the
 * ids sent explicitly, plus anyone the text names, minus the author (nobody
 * is told about their own note), each once. Explicit ids first, then in
 * order of appearance. Ids that are not on the roster are dropped — only a
 * real, active team member can ever be assigned.
 */
export function resolveTags<T extends Mentionable>(
  text: string, explicitIds: readonly string[], team: readonly T[], authorId: string,
): T[] {
  const byId = new Map(team.map(t => [t.id, t]))
  const out: T[] = []
  const seen = new Set<string>()
  const add = (t: T | undefined) => {
    if (!t || t.id === authorId || seen.has(t.id)) return
    seen.add(t.id)
    out.push(t)
  }
  for (const id of explicitIds) add(byId.get(String(id)))
  for (const m of extractMentions(text, team)) add(byId.get(m.id))
  return out
}

/** Replace the "@…" being typed with the chosen name, plus a space, and say
 *  where the caret should land afterwards. */
export function insertMention(
  text: string, start: number, caret: number, name: string,
): { text: string; caret: number } {
  const head = text.slice(0, start)
  const tail = text.slice(caret)
  const inserted = `@${name.trim()} `
  return { text: head + inserted + tail, caret: head.length + inserted.length }
}
