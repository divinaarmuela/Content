// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readPostState, type PostState } from '@/app/lib/post-stage-core'
import type { PostWindowApi } from '@/app/lib/post-window-core'

/**
 * EDIT ON A BOOKED POST, THEN NEW PICTURES (25 Nov 2026 — Karly, MGMT's "How long does a liquidation actually
 * take?" carousel). She pressed Edit on the booked post, swapped slides and booked it again, twice; `post_events`
 * shows `edit_booked` then `schedule_direct` with no `save` between, and versions 7 and 8 hold version 2's five
 * files. The new pictures never reached the post, and the old ones were booked back in without a word.
 *
 * The window here is the real one, clicked: the live row, the server and the media picker are the only fakes.
 * The live row lands BEFORE the Edit's own answer — the usual order (PostWindow's own note of 29 Sep 2026).
 */

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    rows: {} as Record<string, Record<string, Record<string, unknown>>>,
    listeners,
    put(table: string, row: Record<string, unknown>) {
      this.rows = { ...this.rows, [table]: { ...(this.rows[table] ?? {}), [String(row.id)]: row } }
      for (const l of listeners) l()
    },
    me: null as null | { id: string; role: string; name: string },
    picked: [] as { url: string; name: string; type: string }[],
  }
})

vi.mock('@/lib/db-client', () => ({
  useRow: (name: string, id: string | null | undefined) => {
    const row = useSyncExternalStore(
      (l: () => void) => { h.listeners.add(l); return () => { h.listeners.delete(l) } },
      () => (id ? h.rows[name]?.[id] ?? null : null),
    )
    return { row, loading: false, error: null }
  },
  useTable: (name: string) => ({ rows: Object.values(h.rows[name] ?? {}), loading: false, error: null }),
}))
vi.mock('@/app/dashboard/useRole', () => ({ useRole: () => ({ me: h.me, can: () => true, loading: false }) }))
vi.mock('@/app/dashboard/production/workHooks', () => ({ useTeamMembers: () => [] }))
vi.mock('@/app/dashboard/social/schedule/Tour', () => ({ default: () => null, useTourOnce: () => ({ open: false, close: () => {} }) }))
vi.mock('@/app/dashboard/social/schedule/CoverPicker', () => ({ default: () => null }))
// the picker, reduced to its one promise: "Use these files" hands the chosen set to the window
vi.mock('@/app/dashboard/social/schedule/MediaPicker', () => ({
  default: ({ onSave }: { onSave: (s: unknown[]) => void }) => (
    <button type="button" data-test-pick onClick={() => onSave(h.picked)}>Use these files</button>
  ),
}))
vi.mock('@/app/dashboard/social/AssetCheck', () => ({ default: () => null }))
vi.mock('@/app/components/social/PostPreview', () => ({ default: () => null }))
vi.mock('@/app/dashboard/social/usePlayable', () => ({ usePlayable: () => (u: string) => u }))
vi.mock('@/app/lib/measure-media-client', () => ({ isMeasured: () => true, measureUrl: async () => ({}) }))

const { default: PostWindow } = await import('@/app/dashboard/social/schedule/PostWindow')

const NOW = Date.now()
const inHours = (n: number) => new Date(NOW + n * 3600_000).toISOString()
const img = (n: string) => ({ url: `https://files.example.test/${n}.png`, name: `${n}.png`, type: 'image' })
const OLD = ['299', '300', '301', '302', '303'].map(img)
const NEW = ['365', '366', '367', '368', '369'].map(img)

const ACCOUNTS = [
  { id: 'ig', client_id: 'c1', platform: 'instagram', provider_account_id: 'x', name: 'MGMT', username: 'mgmt', avatar_url: null, active: true, connected_at: '', last_synced_at: '', health: null, contact_id: null },
]
const CONTEXT = {
  clientId: 'c1', tz: 'Australia/Melbourne',
  client: { name: 'MGMT', email: 'owner@mgmt.invalid', client_approval_required: false },
  accounts: ACCOUNTS as never, contacts: [], locations: [], suggested: [],
}
const MANAGER = { id: 'karly', role: 'account_manager', name: 'Karly' }

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1', client_id: 'c1', item_id: 'item1', source_item_id: 'item1', created_by: 'karly',
    stage: 'booked', rev: 19, stage_at: inHours(-2), draft_version: 7, sent_version: 6,
    slides: OLD, caption: 'How long does a liquidation actually take?', channels: ['ig'], per_channel: {},
    scheduled_for: inHours(48), timezone: 'Australia/Melbourne',
    approval_steps: null, approval: { version: 6, by: 'karly', hat: 'am', on_behalf_of_client: false, agreed_via: null, note: null, at: inHours(-3) },
    qc_pass: null, changes_asked: null, client_send: null, last_client_send: null,
    booking: { job_ids: ['j1'], pending: false, at: inHours(-3), for_time: inHours(48) },
    outcomes: {}, problem: null, cancelled: null, assigned_to: null, source_deleted: false,
    ...over,
  }
}

let host: HTMLDivElement
let root: Root
const click = async (sel: string) => {
  const el = host.querySelector<HTMLButtonElement>(sel)
  if (!el) throw new Error(`nothing matches ${sel}`)
  await act(async () => { el.click() })
}
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
  h.rows = {}; h.listeners.clear(); h.me = MANAGER; h.picked = NEW
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('Edit on a booked post, then new pictures', () => {
  for (const order of ['the live row lands before the answer', 'the answer lands before the live row'] as const) {
    it(`the new pictures are kept and saved — ${order}`, async () => {
      const draft = row({ stage: 'draft', rev: 20, booking: null })
      const saves: { slides: { url: string }[]; expect_rev: number }[] = []
      const api: PostWindowApi = {
        create: async () => { throw new Error('create is not part of this') },
        save: async (_id, body) => {
          saves.push(body as never)
          const next = { ...draft, rev: 21, slides: (body as { slides: unknown[] }).slides }
          return { ok: true, row: next } as never
        },
        act: async (_id, req) => {
          if ((req as { action: string }).action !== 'edit_booked') throw new Error(`unexpected ${(req as { action: string }).action}`)
          if (order === 'the live row lands before the answer') await act(async () => { h.put('social_posts', draft) })
          return { ok: true, words: 'Off the schedule — now a draft', stage: 'draft', post: readPostState(draft) as PostState } as never
        },
      }

      h.put('social_posts', row())
      await act(async () => { root.render(<PostWindow postId="p1" context={CONTEXT} onClose={() => {}} api={api} />) })
      await settle()

      // Edit, and yes to "this takes it off the schedule"
      await click('[data-action="edit_booked"]')
      await click('[data-go="edit_booked"]')
      await settle()
      if (order === 'the answer lands before the live row') { await act(async () => { h.put('social_posts', draft) }); await settle() }
      expect(host.querySelector('[data-stage-chip]')?.textContent).toBe('Draft')

      // the new pictures, chosen in the picker
      await click('[data-test-pick]')
      await settle()
      expect(host.textContent, 'the window knows there is unsaved work').toContain('Not saved yet')

      // Save: the server is sent the NEW pictures
      await click('[data-action="save"]')
      await settle()
      expect(saves, 'a changed draft is saved').toHaveLength(1)
      expect(saves[0].slides.map(s => s.url)).toEqual(NEW.map(s => s.url))
      expect(saves[0].expect_rev).toBe(20)
    })
  }
})
