import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import {
  briefAfterHandover, handToGroups, handoverDate, handoverLine, handoverSubject,
  handoverWords, personLabel, tidyNote,
} from '../app/lib/hand-over-core'
import { eventWords } from '../app/lib/notification-words'
import { pageCards } from '../app/lib/board-view-core'

/**
 * HAND TO… — a card given to somebody on purpose.
 *
 * Three things have to hold, and each has burnt somebody before:
 *   1. the words APPEND to "what needs doing"; nothing already on the card
 *      is lost because someone was handed it;
 *   2. exactly ONE person hears — the person it was handed to — and the
 *      ordinary "assigned to you" does not go out as well;
 *   3. a person who may not edit the card is not offered the menu item, and
 *      the route refuses them even if they ask anyway.
 */

/* ── 1. the words ─────────────────────────────────────────────────── */

describe('what needs doing gains a line, and never loses one', () => {
  it('appends under the existing brief, signed and dated', () => {
    const out = briefAfterHandover('Shoot the hero reel.', 'Divina', 'Cut a 30s version for Reels', '2026-09-07T04:00:00Z')
    expect(out).toBe('Shoot the hero reel.\n\n— Handed over by Divina, 7 Sep 2026: Cut a 30s version for Reels')
  })

  it('keeps every earlier handover — three in a row all still read', () => {
    let brief: string | null = 'Original brief.'
    brief = briefAfterHandover(brief, 'Divina', 'Cut a 30s version', '2026-09-07T04:00:00Z')
    brief = briefAfterHandover(brief, 'Yusuf', 'Add captions', '2026-09-08T04:00:00Z')
    brief = briefAfterHandover(brief, 'Ada', 'Book it in for Friday', '2026-09-09T04:00:00Z')
    expect(brief).toContain('Original brief.')
    expect(brief).toContain('Cut a 30s version')
    expect(brief).toContain('Add captions')
    expect(brief).toContain('Book it in for Friday')
    // in the order they happened
    expect(brief!.indexOf('Cut a 30s')).toBeLessThan(brief!.indexOf('Add captions'))
  })

  it('an empty card gets just the line — no leading blank space', () => {
    expect(briefAfterHandover(null, 'Divina', 'Cut it down', '2026-09-07T00:00:00Z'))
      .toBe('— Handed over by Divina, 7 Sep 2026: Cut it down')
    expect(briefAfterHandover('   ', 'Divina', 'Cut it down', '2026-09-07T00:00:00Z'))
      .toBe('— Handed over by Divina, 7 Sep 2026: Cut it down')
  })

  it('no words means the brief is not touched at all — null, not an empty string', () => {
    expect(briefAfterHandover('Shoot the hero reel.', 'Divina', '', '2026-09-07T00:00:00Z')).toBeNull()
    expect(briefAfterHandover('Shoot the hero reel.', 'Divina', '   \n ', '2026-09-07T00:00:00Z')).toBeNull()
    expect(briefAfterHandover('Shoot the hero reel.', 'Divina', null)).toBeNull()
  })

  it('the date is written the same way whoever wrote it — no locale in the card', () => {
    expect(handoverDate('2026-01-03T22:00:00Z')).toBe('3 Jan 2026')
    expect(handoverDate('2026-12-31')).toBe('31 Dec 2026')
    // an unreadable stamp costs the date, never the words
    expect(handoverDate('not a date')).toBe('')
    expect(handoverLine('Divina', 'Cut it', 'not a date')).toBe('— Handed over by Divina: Cut it')
  })

  it('trims and bounds what was typed', () => {
    expect(tidyNote('  hello \r\n world  ')).toBe('hello \n world')
    expect(tidyNote('x'.repeat(5000))).toHaveLength(2000)
    expect(tidyNote(null)).toBe('')
  })
})

/* ── 2. the sentence they are told ────────────────────────────────── */

describe('the person is told in plain words', () => {
  it('says who, which card, and what they should do', () => {
    expect(handoverWords('Divina', 'Hero reel', 'cut a 30s version for Reels'))
      .toBe('Divina handed you “Hero reel” — cut a 30s version for Reels')
  })

  it('still reads as a sentence with no words attached', () => {
    expect(handoverWords('Divina', 'Hero reel', '')).toBe('Divina handed you “Hero reel”')
  })

  it('a very long ask does not become a very long subject line', () => {
    const subject = handoverSubject('Divina', 'Hero reel', 'x'.repeat(400))
    expect(subject.length).toBeLessThanOrEqual(140)
    expect(subject.endsWith('…')).toBe(true)
  })

  it('the bell row says something a person wrote', () => {
    expect(eventWords('handed_over')).toBe('Handed to you — with what they want done')
    // never the raw enum
    expect(eventWords('handed_over')).not.toContain('_')
  })
})

/* ── 3. the picker ────────────────────────────────────────────────── */

describe('the person picker', () => {
  const TEAM = [
    { id: 'u-sc', name: 'Sam', email: 'sam@x.invalid', role: 'scheduler' },
    { id: 'u-ed', name: 'Eden', email: 'eden@x.invalid', role: 'editor' },
    { id: 'u-am', name: 'Ada', email: 'ada@x.invalid', role: 'account_manager' },
    { id: 'u-cl', name: 'Client Co', email: 'c@x.invalid', role: 'client' },
    { id: 'u-ed2', name: 'Abe', email: 'abe@x.invalid', role: 'editor' },
  ]

  it('groups by what people do, editors and schedulers first', () => {
    const groups = handToGroups(TEAM)
    expect(groups.map(g => g.role)).toEqual(['editor', 'scheduler', 'account_manager'])
    expect(groups.map(g => g.label)).toEqual(['Editor or designer', 'Scheduler', 'Account manager'])
  })

  it('a SCHEDULER is an ordinary choice — this is how work reaches their page', () => {
    const schedulers = handToGroups(TEAM).find(g => g.role === 'scheduler')
    expect(schedulers?.people.map(p => p.id)).toEqual(['u-sc'])
  })

  it('never offers a client — a client never carries a card', () => {
    expect(handToGroups(TEAM).flatMap(g => g.people).map(p => p.id)).not.toContain('u-cl')
  })

  it('names inside a group are in order, and nobody is nameless', () => {
    const editors = handToGroups(TEAM).find(g => g.role === 'editor')
    expect(editors?.people.map(p => p.name)).toEqual(['Abe', 'Eden'])
    expect(personLabel({ name: '', email: 'only@x.invalid' })).toBe('only@x.invalid')
    expect(personLabel(null)).toBe('Someone')
  })

  it('a role nobody planned for still shows its people, under its own heading', () => {
    const groups = handToGroups([...TEAM, { id: 'u-x', name: 'Xen', email: 'x@x.invalid', role: 'archivist' }])
    const last = groups[groups.length - 1]
    expect(last.role).toBe('archivist')
    expect(last.label).toBe('archivist')
    expect(last.people.map(p => p.id)).toEqual(['u-x'])
  })
})

/* ── 4. a card handed to a scheduler is on the Scheduler page ─────── */

describe('handing a card to a scheduler puts it in front of them', () => {
  const viewer = { id: 'u-sc', role: 'scheduler' as const }
  const card = (status: string) => ({
    id: `i-${status}`, title: 'Hero reel', status, client_id: 'c1',
    owner_id: 'u-sc', current_version_number: 1,
    brief: 'Original brief.\n\n— Handed over by Divina, 7 Sep 2026: cut a 30s version for Reels',
  }) as never

  it('shows on their board whatever column it sits in', () => {
    const cards = ['draft_uploaded', 'internal_review', 'client_review', 'approved_for_scheduling', 'scheduled']
      .map(card)
    const shown = pageCards('scheduler', cards, viewer, '2026-09-07')
    expect(shown).toHaveLength(cards.length)
  })

  it('and the words handed with it travel on the card itself', () => {
    const [one] = pageCards('scheduler', [card('draft_uploaded')], viewer, '2026-09-07')
    expect((one as { brief?: string }).brief).toContain('cut a 30s version for Reels')
  })
})

/* ── 5. the menu item, and who is offered it ──────────────────────── */

const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const read = (...parts: string[]) => code(readFileSync(join(process.cwd(), ...parts), 'utf8'))

describe('"Hand to…" is offered where it belongs and nowhere else', () => {
  const boardCard = read('app', 'dashboard', 'board', 'BoardCard.tsx')
  const board = read('app', 'dashboard', 'board', 'Board.tsx')
  const detail = read('app', 'dashboard', 'production', '[id]', 'CardDetail.tsx')
  const dialogs = read('app', 'dashboard', 'board', 'BoardDialogs.tsx')

  it('the board card offers it, above Delete', () => {
    expect(boardCard).toContain('Hand to…')
    const hand = boardCard.indexOf('Hand to…')
    const del = boardCard.indexOf('Delete this card')
    expect(hand).toBeGreaterThan(-1)
    expect(del).toBeGreaterThan(hand)
  })

  it('…only inside the block a person who may edit the card sees', () => {
    // the item lives between `canEdit && (` and the delete separator
    const editBlock = boardCard.slice(boardCard.indexOf('{canEdit && ('), boardCard.indexOf('{mayDelete && ('))
    expect(editBlock).toContain('Hand to…')
  })

  it('the board hands the opener down only for a card this person may edit', () => {
    expect(board).toMatch(/onHandTo=\{canEdit\(c\) && \(isManager \|\| viewer\.role === 'general'\) \? setHandToFor : undefined\}/)
  })

  it('the side panel offers the same item, gated by the same rule as the route', () => {
    expect(detail).toContain('Hand to…')
    expect(detail).toMatch(/const canHandOver = isTeam/)
    expect(detail).toMatch(/canManage \|\| detail\.owner_id === viewer\.id \|\| schedulerIds\.includes\(viewer\.id\)/)
  })

  it('both places open the SAME dialog — one component, not two', () => {
    expect(dialogs).toContain('export function HandToDialog')
    expect(board).toMatch(/<HandToDialog\b/)
    expect(detail).toMatch(/<HandToDialog\b/)
    expect(detail).toMatch(/from '\.\.\/\.\.\/board\/BoardDialogs'/)
  })

  it('the dialog appends rather than overwrites, and says so to the route', () => {
    expect(dialogs).toMatch(/briefAfterHandover\(\s*card\.brief \?\? null/)
    expect(dialogs).toMatch(/hand_over: words \|\| true/)
    // one PATCH on the route that already exists — no new endpoint
    expect(dialogs).toMatch(/`\/api\/production\/items\/\$\{card\.id\}`/)
    expect(dialogs).toContain("method: 'PATCH'")
  })

  it('the picker starts on nobody, and the button says what it does', () => {
    expect(dialogs).toMatch(/const \[to, setTo\] = useState\(''\)/)
    expect(dialogs).toContain('Hand it over')
    expect(dialogs).toContain('What you want them to do — cut a 30s version for Reels…')
  })

  it('every control in the dialog clears the 44px floor', () => {
    const block = dialogs.slice(dialogs.indexOf('export function HandToDialog'), dialogs.indexOf('export type ClientChoice'))
    // the field and the button classes are the file's own shared constants,
    // both h-11 — the dialog uses them rather than inventing a size
    expect(block).toContain('className={field}')
    expect(block).toContain('className={primary}')
  })
})

/* ── 6. the round trip ────────────────────────────────────────────── */

const ITEM = 'bbbbbbbb-0000-4000-8000-000000000001'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Divina', clerk_user_id: null }
const ED = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const SC = { id: 'u-sc', role: 'scheduler', email: 'sc@x.invalid', name: 'Sam', clerk_user_id: null }
const OTHER = { id: 'u-ed2', role: 'editor', email: 'ed2@x.invalid', name: 'Abe', clerk_user_id: null }

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  emails: [] as Record<string, unknown>[],
}))

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => h.user,
  requireRole: async () => h.user,
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    const row = await table('content_items').get(id)
    if (!row) throw Object.assign(new Error('Item not found'), { status: 404 })
    return row
  },
  shapeItemDetail: (_u: unknown, item: unknown) => item,
}))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { h.emails.push(m); return 'sent' }),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(),
  mirrorRawAssets: vi.fn(), newRawAssets: () => [], itemMirrorProgress: async () => null,
}))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { PATCH } = await import('../app/api/production/items/[id]/route')

const patch = async (body: unknown) => {
  const res = await PATCH(
    new Request(`https://x.test/api/production/items/${ITEM}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

/** the notification is fire-and-forget; let it drain */
const drain = () => new Promise(r => setTimeout(r, 20))

/** only the round-trip block seeds a database; the pure tests above do not */
let fake: ReturnType<typeof seedDb> | null = null
const item = () => fake!.rows('content_items')[0] as Record<string, unknown>

const seed = (owner: string | null = ED.id, brief = 'Shoot the hero reel.') => seedDb({
  clients: [{ id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne' }] as unknown as Row[],
  team_users: [AM, ED, SC, OTHER].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [{ id: `${AM.id}__c1`, team_user_id: AM.id, client_id: 'c1' }] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Hero reel', status: 'draft_uploaded', content_type: 'reel',
    owner_id: owner, scheduler_ids: [], current_version_number: 1, batch_id: null,
    work_kind_id: null, client_approval_required: true, due_date: null, brief,
  }] as unknown as Row[],
})

beforeEach(() => { h.user = AM; h.emails = [] })
afterEach(() => { fake?.restore(); fake = null })

describe('PATCH /api/production/items/[id] — handed over', () => {
  const handOff = (to: string, words: string, brief: string | null) => patch({
    owner_id: to,
    ...(brief === null ? {} : { brief }),
    hand_over: words || true,
  })

  it('sets who is on it and keeps what was already on the card', async () => {
    fake = seed()
    const brief = briefAfterHandover('Shoot the hero reel.', 'Divina', 'cut a 30s version for Reels', '2026-09-07T00:00:00Z')
    const r = await handOff(SC.id, 'cut a 30s version for Reels', brief)
    await drain()
    expect(r.status).toBe(200)
    expect(item().owner_id).toBe(SC.id)
    expect(String(item().brief)).toContain('Shoot the hero reel.')
    expect(String(item().brief)).toContain('— Handed over by Divina, 7 Sep 2026: cut a 30s version for Reels')
    // who handed it out is recorded, as any reassignment is
    expect(item().assigned_by).toBe(AM.id)
  })

  it('tells the person it was handed to — once, bell and email, in those words', async () => {
    fake = seed()
    await handOff(SC.id, 'cut a 30s version for Reels', null)
    await drain()
    expect(h.emails).toHaveLength(1)
    expect(h.emails[0]).toMatchObject({
      eventType: 'handed_over', recipientId: SC.id, recipientEmail: SC.email,
      subject: 'Divina handed you “Hero reel” — cut a 30s version for Reels',
    })
    expect(h.emails[0].bellOnly).toBeFalsy()
    // team-facing, so it is never held back with the client's side
    expect(h.emails[0].toClient).toBeFalsy()
    expect(String(h.emails[0].bodyHtml)).toContain('cut a 30s version for Reels')
  })

  it('and nobody else — not the previous holder, not the managers', async () => {
    fake = seed()
    await handOff(SC.id, 'cut a 30s version', null)
    await drain()
    expect(h.emails.map(e => e.recipientId)).toEqual([SC.id])
  })

  it('the ordinary "assigned to you" does NOT go out as well', async () => {
    fake = seed()
    await handOff(SC.id, 'cut a 30s version', null)
    await drain()
    expect(h.emails.map(e => e.eventType)).toEqual(['handed_over'])
  })

  it('a plain change of Who is unchanged — still the job-pack email', async () => {
    fake = seed()
    await patch({ owner_id: SC.id })
    await drain()
    expect(h.emails.map(e => e.eventType)).toEqual(['job_assigned'])
  })

  it('handing it to yourself tells nobody', async () => {
    fake = seed()
    await handOff(AM.id, 'I will do it', null)
    await drain()
    expect(h.emails).toEqual([])
    expect(item().owner_id).toBe(AM.id)
  })

  it('no words: the person is still told, and the brief is untouched', async () => {
    fake = seed()
    await handOff(SC.id, '', null)
    await drain()
    expect(item().brief).toBe('Shoot the hero reel.')
    expect(h.emails).toHaveLength(1)
    expect(h.emails[0].subject).toBe('Divina handed you “Hero reel”')
  })

  it('a person who may not edit this card cannot hand it on', async () => {
    fake = seed()
    h.user = OTHER   // an editor who neither holds it nor manages the client
    const r = await handOff(SC.id, 'cut it down', null)
    expect(r.status).toBe(403)
    await drain()
    expect(item().owner_id).toBe(ED.id)
    expect(h.emails).toEqual([])
  })

  it('the person HOLDING it may hand it on', async () => {
    fake = seed()
    h.user = ED
    const r = await handOff(SC.id, 'over to you for booking', null)
    await drain()
    expect(r.status).toBe(200)
    expect(item().owner_id).toBe(SC.id)
    expect(h.emails.map(e => e.recipientId)).toEqual([SC.id])
  })

  it('a deactivated or unknown person is refused before anything is written', async () => {
    fake = seed()
    const r = await handOff('nobody-at-all', 'do this', null)
    expect(r.status).toBe(400)
    expect(item().owner_id).toBe(ED.id)
  })
})
