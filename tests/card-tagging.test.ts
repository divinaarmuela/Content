import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { actingRoles, taggedIdsOfItem } from '../app/lib/workflow-core'
import { mayDeleteCard } from '../app/lib/board-view-core'
import { assignedItemsPredicate } from '../app/lib/scope-client'

/**
 * TAGGED ON A CARD = ON THE CARD (the owner, 3 Nov 2026: "we can tag any team member in the comments and anyone
 * that's tagged from now on will have that card also in their page … if client comments they would receive it too
 * and they can delete and also do anything, move cards etc").
 */
const src = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('everyone tagged on a card holds it', () => {
  const card = { id: 'i1', owner_id: 'ed', scheduler_ids: [], tagged_ids: ['des', 'am2'], status: 'draft_uploaded' }

  it('reads the list off the card, and nothing else counts', () => {
    expect(taggedIdsOfItem(card)).toEqual(['des', 'am2'])
    expect(taggedIdsOfItem({ tagged_ids: 'des' })).toEqual([])
    expect(taggedIdsOfItem({})).toEqual([])
  })

  it('a tagged designer wears the holder’s hats — the maker’s and the scheduler’s — never a manager’s', () => {
    const hats = actingRoles({ id: 'des', role: 'designer' as never }, card)
    expect(hats).toContain('editor')
    expect(hats).toContain('scheduler')
    expect(hats).not.toContain('account_manager')
    // someone not tagged holds nothing
    expect(actingRoles({ id: 'other', role: 'designer' as never }, card)).toEqual([])
  })

  it('a tagged person may delete it as its holder could; not once it is handed on, booked or posted', () => {
    expect(mayDeleteCard({ id: 'des', role: 'designer' }, card)).toBe(true)
    expect(mayDeleteCard({ id: 'other', role: 'designer' }, card)).toBe(false)
    expect(mayDeleteCard({ id: 'des', role: 'designer' }, { ...card, status: 'scheduled' })).toBe(false)
    expect(mayDeleteCard({ id: 'des', role: 'designer' }, { ...card, scheduler_ids: ['sc'] })).toBe(false)
  })

  it('the card opens for them whoever’s client it is', () => {
    const open = assignedItemsPredicate({ id: 'des', role: 'designer' } as never, new Set(), new Set())
    expect(open(card as never)).toBe(true)
    expect(open({ ...card, tagged_ids: [] } as never)).toBe(false)
  })
})

describe('the wiring', () => {
  it('a comment’s tags join the card under a claim, the client’s comments reach them, and team notes too', () => {
    const route = src('app/api/production/items/[id]/comments/route.ts')
    expect(route).toMatch(/table<ContentItem>\('content_items'\)\.claim\(id, cur =>/)
    expect(route).toMatch(/tagged_ids: next/)
    expect(route).toMatch(/const onCard = taggedIdsOfItem\(item\)/)
    expect(route).toMatch(/\.\.\.taggedIdsOfItem\(item\)\],/)
  })
  it('the server opens a tagged card, and both boards show cards their viewer is tagged on', () => {
    const access = src('app/lib/production-access.ts')
    expect(access).toMatch(/\|\| taggedIdsOfItem\(item\)\.includes\(me\)/)
    expect(access).toMatch(/taggedIdsOfItem\(item\)\.includes\(user\.id\)\) return true/)
    expect(src('app/dashboard/editor/page.tsx')).toMatch(/slug !== 'graphics' \|\| taggedIdsOfItem\(c as \{ tagged_ids\?: unknown \}\)\.includes\(viewer\.id\)/)
    expect(src('app/dashboard/designer/page.tsx')).toMatch(/slug === 'graphics' \|\| \(slug !== 'shoot_brief' && taggedIdsOfItem\(c as \{ tagged_ids\?: unknown \}\)\.includes\(viewer\.id\)\)/)
  })
})
