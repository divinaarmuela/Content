import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { heroCounts, portalSections, sectionCounts } from '../app/lib/portal-core'

/**
 * THE PORTAL'S LAYOUT — the previous one, which the owner asked back for.
 *
 * The client's name in giant type at the top with the four counters and the
 * MD logo, a sticky strip with their name once scrolled, then the sections
 * top to bottom: Needs your review · their shoots (each with the planning
 * board OPEN underneath) · In production · Approved & scheduled · Published.
 * Inside: today's cards — one tap to approve, no note, comments pinned to
 * everything. No quotas, no second "final post" approval.
 */

vi.mock('../app/lib/post-analytics', () => ({
  analyticsForItems: async () => new Map(),
  refreshStaleAnalyticsInBackground: vi.fn(),
}))

const { getPortalData } = await import('../app/lib/portal-data')

const read = (p: string) => readFileSync(p, 'utf8')
const page = read('app/portal/[token]/page.tsx')
const view = read('app/components/portal/PortalSectionsView.tsx')
const card = read('app/components/portal/PortalBoard.tsx')
const client = read('app/client/page.tsx')
const shootPage = read('app/portal/[token]/shoot/[id]/page.tsx')

describe('the hero and the strip', () => {
  it('carries the client’s name in giant type, the last word highlighted, under a CONTENT PORTAL eyebrow', () => {
    expect(page).toMatch(/data-portal-hero/)
    expect(page).toMatch(/<h1[^>]*>\s*\{firstWords\}/)
    expect(page).toMatch(/\{lastWord\}/)
    expect(page).toMatch(/text="CONTENT PORTAL"/)
    expect(page).toMatch(/MDLogo-trim\.png/)
  })

  it('shows the four counters, in the same four words as the section headings', () => {
    for (const w of ['Needs your review', 'In production', 'Approved & scheduled', 'Published']) expect(page).toContain(w)
    expect(page).toMatch(/heroCounts\(data\.cards\)/)
  })

  it('has the sticky strip with the client’s name once scrolled', () => {
    expect(page).toMatch(/<header className="sticky top-0[^"]*">[\s\S]*?\{data\.client\.name\}/)
  })

  it('the signed-in client page renders the same thing', () => {
    expect(client).toMatch(/<PortalSectionsView/)
    expect(client).toMatch(/<PortalLive/)
    expect(client).toMatch(/data-portal-hero/)
    expect(client).toMatch(/\{data\.client\.name\}/)
  })
})

describe('the sections, in order, with the board open under each shoot', () => {
  it('reads review → shoots → production → approved → published', () => {
    const order = ["grid('review')", "data-portal-section=\"shoots\"", "grid('production')", "grid('approved')", "grid('published')"]
      .map(s => view.indexOf(s))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('draws the planning board open under the shoot’s card — no toggle, no link to get to it', () => {
    expect(view).toMatch(/<ShootBoard[\s\S]*?cards=\{card\.shoot\.canvas_cards\}/)
    expect(view).not.toMatch(/Show the planning board|See the planning board/)
    expect(card).not.toMatch(/See the planning board/)
    expect(shootPage).toMatch(/<ShootBoard/)
  })

  it('has no quotas and no second approval on the page', () => {
    for (const src of [page, view, card, client, shootPage]) {
      expect(src).not.toMatch(/at a glance|CommitmentCards|PostReviewSection|ReviewSection|needs your OK|Approve this post/)
    }
    expect(read('app/components/portal/PortalSections.tsx')).not.toMatch(/export function (ReviewCard|ReviewSection|PortalItemCard|PortalSection|PostReviewCard|PostReviewSection|CommitmentCards)\b/)
  })

  it('the moodboard toggle is gone from the shoot page', () => {
    const shoot = read('app/dashboard/production/shoots/[id]/page.tsx')
    expect(shoot).not.toMatch(/Also show the moodboard|patch\('share_board'/)
  })
})

describe('approving is one tap, with no note — ever', () => {
  it('the card sends no note with an approval; the words go only with a change request', () => {
    expect(card).toMatch(/const text = action === 'request_changes' \? note\.trim\(\) : ''/)
    expect(card).not.toMatch(/Approve with a note|approve-with-note|withNote/)
    // the toast thanks them and says nothing about scheduling
    expect(read('app/lib/portal-words.ts')).toMatch(/APPROVED_TOAST = 'Approved — thank you\.'/)
  })

  it('the client’s name is remembered on the device for comments and change requests', () => {
    expect(card).toMatch(/localStorage\.getItem\(NAME_KEY\)/)
    expect(card).toMatch(/author_name: who/)
  })
})

describe('the four piles, from the five columns', () => {
  const c = (kind: 'work' | 'shoot', column: string, approve = false) =>
    ({ kind, column, actions: { approve, askForChange: approve, comment: true } }) as never

  it('folds the columns into the four sections a client reads', () => {
    const cards = [
      c('work', 'your_review', true), c('work', 'your_review'), c('work', 'making'), c('work', 'checking'),
      c('work', 'approved'), c('work', 'posted'),
    ]
    const s = portalSections(cards)
    expect(s.map(x => [x.key, x.cards.length])).toEqual([['review', 1], ['production', 3], ['approved', 1], ['published', 1]])
    expect(sectionCounts(cards)).toEqual({ review: 1, production: 3, approved: 1, published: 1 })
  })

  it('a plan waiting on the client counts as needing their review; other shoots count nowhere', () => {
    const cards = [c('work', 'making'), c('shoot', 'your_review', true), c('shoot', 'approved'), c('shoot', 'posted')]
    expect(heroCounts(cards)).toEqual({ review: 1, production: 1, approved: 0, published: 0 })
  })
})

describe('the board comes with the plan', () => {
  let fake: ReturnType<typeof seedDb>
  afterEach(() => fake?.restore())

  it('a shared shoot carries its board on the main page whatever share_board says', async () => {
    fake = seedDb({
      clients: [{ id: 'client-1', name: 'ZZ TEST', timezone: 'Australia/Melbourne' }] as unknown as Row[],
      team_users: [], team_user_clients: [], work_kinds: [], content_items: [], batch_comments: [],
      monthly_commitments: [], client_brand: [], intake_forms: [],
      batches: [
        { id: 'b-off', client_id: 'client-1', title: 'Old row', status: 'brief', shared_with_client: true, share_board: false,
          board_name: 'The plan', canvas_cards: [{ id: 'n1', kind: 'note', text: 'hi', x: 0, y: 0, w: 208, z: 1 }] },
        { id: 'b-none', client_id: 'client-1', title: 'Older row', status: 'brief', shared_with_client: true,
          canvas_cards: [{ id: 'n2', kind: 'note', text: 'hi', x: 0, y: 0, w: 208, z: 1 }] },
        { id: 'b-private', client_id: 'client-1', title: 'Not shared', status: 'locked', shared_with_client: false,
          canvas_cards: [{ id: 'n3', kind: 'note', text: 'secret', x: 0, y: 0, w: 208, z: 1 }] },
      ] as unknown as Row[],
    })
    const data = (await getPortalData('client-1'))!
    const by = (id: string) => data.cards.find(c => c.kind === 'shoot' && c.id === id)!.shoot!
    expect(by('b-off').canvas_cards.map(c => c.id)).toEqual(['n1'])
    expect(by('b-off').board_name).toBe('The plan')
    expect(by('b-off').board_cards).toBe(1)
    expect(by('b-none').canvas_cards.map(c => c.id)).toEqual(['n2'])
    // an unshared shoot still shows nothing of its working detail
    expect(by('b-private').canvas_cards).toEqual([])
    expect(data.shoots.find(s => s.id === 'b-off')!.canvas_cards).toHaveLength(1)
  })
})
