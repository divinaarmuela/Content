/**
 * THE SEARCH BAR, AS ASANA'S (the owner, 27 Oct 2026: "we also need this at the search bar, like Asana, for to-do"):
 * type and the matches drop down — Tasks, People, Messages — each a few deep with "Show more". Pure: what to search
 * in, what was typed, what comes back, in what order.
 */

export type SearchTask = { id: string; title: string; status?: string | null; owner_id?: string | null; client_id?: string | null; due_date?: string | null; parent_id?: string | null }
export type SearchPerson = { id: string; name: string; email?: string | null }
export type SearchComment = { id: string; todo_id: string; body: string; author_id?: string | null; created_at?: string | null }

export type SearchKind = 'all' | 'tasks' | 'people' | 'messages'
export const SEARCH_KINDS: { key: SearchKind; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'tasks', label: 'Tasks' }, { key: 'people', label: 'People' }, { key: 'messages', label: 'Messages' },
]
/** how many of each show before "Show more" */
export const FIRST_SHOWN = 3

const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
/** every word typed must be somewhere in the text, in any order ("releeph edm" finds "Releeph EDMs (3 a week)") */
export function matchesAll(text: string, query: string): boolean {
  const t = norm(text)
  const words = norm(query).split(/\s+/).filter(Boolean)
  return words.length > 0 && words.every(w => t.includes(w))
}
/** a closer match first: the whole phrase, then a word starting with it, then anywhere */
function rank(text: string, query: string): number {
  const t = norm(text), q = norm(query).trim()
  if (t === q) return 0
  if (t.startsWith(q)) return 1
  if (new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 2
  if (t.includes(q)) return 3
  return 4
}
/** the words of a comment, without the markup a rich comment can carry */
export function plainText(html: string): string {
  return String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

export type SearchResults = { tasks: SearchTask[]; people: SearchPerson[]; messages: SearchComment[] }

/** everything that matches, best first: open tasks before done ones, then by how well, then the soonest due */
export function searchAll(input: { tasks: readonly SearchTask[]; people: readonly SearchPerson[]; comments: readonly SearchComment[] }, query: string): SearchResults {
  const q = query.trim()
  if (!q) return { tasks: [], people: [], messages: [] }
  const tasks = input.tasks.filter(t => t.title && matchesAll(t.title, q))
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || rank(a.title, q) - rank(b.title, q)
      || String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')))
  const people = input.people.filter(p => matchesAll(`${p.name} ${p.email ?? ''}`, q))
    .sort((a, b) => rank(a.name, q) - rank(b.name, q) || a.name.localeCompare(b.name))
  const messages = input.comments.filter(c => matchesAll(plainText(c.body), q))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  return { tasks, people, messages }
}

/** a short piece of a comment around the first word that matched */
export function snippet(text: string, query: string, room = 70): string {
  const plain = plainText(text)
  const first = norm(query).split(/\s+/).filter(Boolean)[0] ?? ''
  const at = first ? norm(plain).indexOf(first) : -1
  if (at < 0 || plain.length <= room) return plain.slice(0, room) + (plain.length > room ? '…' : '')
  const start = Math.max(0, at - Math.floor(room / 3))
  return `${start > 0 ? '…' : ''}${plain.slice(start, start + room)}${start + room < plain.length ? '…' : ''}`
}
