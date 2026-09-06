import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * A client opens a shared shoot board and can look INSIDE a board tile —
 * the tiles and what they hold reach the portal through the same sanitiser
 * the team's page uses, and nothing more. And the client can never write:
 * the portal renders the very same canvas with `canEdit={false}` and an
 * `onOp` that answers false, so there is no button to press and nothing
 * behind it if there were.
 */

vi.mock('../app/lib/post-analytics', () => ({
  analyticsForItems: async () => new Map(),
  refreshStaleAnalyticsInBackground: vi.fn(),
}))

const { getPortalShootDetail } = await import('../app/lib/portal-thread')

const TOKEN = '3ae353c7-c879-4db7-bf71-dec9657d40e3'
let fake: ReturnType<typeof seedDb>
afterEach(() => fake?.restore())

const seed = (shareBoard: boolean | null) => {
  fake = seedDb({
    clients: [{ id: 'client-1', name: 'ZZ TEST', share_token: TOKEN, timezone: 'Australia/Melbourne' }] as unknown as Row[],
    team_users: [], team_user_clients: [], work_kinds: [], content_items: [], batch_comments: [],
    batches: [{
      id: 'b-1', client_id: 'client-1', title: 'Golf Day', status: 'brief', shared_with_client: true,
      share_board: shareBoard,
      canvas_cards: [
        { id: 'concepts', kind: 'board', name: 'Concepts', icon: 'lightbulb', colour: 'amber', x: 0, y: 0, w: 176, z: 1 },
        { id: 'c1', kind: 'note', text: 'Sunrise on the 9th', x: 0, y: 0, w: 208, z: 2, parent: 'concepts' },
        { id: 'day2', kind: 'board', name: 'Day two', x: 100, y: 0, w: 176, z: 3, parent: 'concepts' },
        { id: 'd1', kind: 'note', text: 'Rain plan', x: 0, y: 0, w: 208, z: 4, parent: 'day2' },
        // junk that must never reach a client: a card under a board that does
        // not exist, and a tile with an unknown colour and a script for an icon
        { id: 'orphan', kind: 'note', text: 'lost', x: 0, y: 0, w: 208, z: 5, parent: 'gone' },
        { id: 'ugly', kind: 'board', name: 'Ugly', icon: '<script>', colour: '#000', x: 0, y: 0, w: 176, z: 6 },
      ],
    }] as unknown as Row[],
  })
}

describe('the client’s view of boards inside the shoot board', () => {
  it('tiles and what is inside them arrive, sanitised, with their nesting intact', async () => {
    seed(true)
    const d = (await getPortalShootDetail(TOKEN, 'b-1'))!
    const ids = d.shoot.canvas_cards.map(c => c.id)
    expect(ids).toEqual(expect.arrayContaining(['concepts', 'c1', 'day2', 'd1', 'ugly']))
    expect(d.shoot.canvas_cards.find(c => c.id === 'd1')?.parent).toBe('day2')
    expect(d.shoot.canvas_cards.find(c => c.id === 'ugly')).toMatchObject({ icon: 'folder', colour: 'blue' })
  })

  it('a card whose board is gone is not sent at all', async () => {
    seed(true)
    const d = (await getPortalShootDetail(TOKEN, 'b-1'))!
    // the stored array is not pruned on read — the page's pure walk hides an
    // orphan — but nothing about it is more than a card with a dangling parent
    const orphan = d.shoot.canvas_cards.find(c => c.id === 'orphan')
    expect(orphan?.parent).toBe('gone')
    const { childrenOf, boardTrail } = await import('../app/lib/shoot-board-core')
    expect(childrenOf(d.shoot.canvas_cards, null).map(c => c.id)).not.toContain('orphan')
    expect(boardTrail(d.shoot.canvas_cards, 'day2').map(c => c.name)).toEqual(['Shoot brief', 'Concepts', 'Day two'])
  })

  it('a board the team switched off is empty for the client, tiles included', async () => {
    seed(false)
    const d = (await getPortalShootDetail(TOKEN, 'b-1'))!
    expect(d.shoot.canvas_cards).toEqual([])
  })
})

describe('the portal page is read-only, by construction', () => {
  const page = readFileSync('app/portal/[token]/shoot/[id]/page.tsx', 'utf8')
  const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')

  it('renders the same canvas with editing off and a save that always refuses', () => {
    expect(page).toMatch(/<BriefCanvas[^>]*canEdit=\{false\}/)
    expect(page).toMatch(/onOp=\{async \(\) => false\}/)
  })

  it('every way to add, rename, move or delete on the canvas is behind the edit gate', () => {
    // the add toolbar (Board button lives there), the selected-card toolbar
    // (Rename / delete), the new-board dialog and the delete guard are all
    // rendered only when the viewer may edit
    expect(canvas).toMatch(/\{!viewOnly && \(\s*<div[^]*?<BoardIcon[^]*?Board\s*<\/Button>/)
    expect(canvas).toMatch(/\{selectedCard && !viewOnly && !editing && \(/)
    expect(canvas).toMatch(/<NewBoardDialog[^]*?open=\{!viewOnly && boardDialog !== null\}/)
    expect(canvas).toMatch(/<AlertDialog open=\{!viewOnly && confirmDelete !== null\}/)
    // a tile still opens for a viewer — looking inside is not editing
    expect(canvas).toMatch(/if \(viewOnly\) \{\s*if \(card\.kind === 'board'\) openBoard\(card\.id\)/)
  })
})
