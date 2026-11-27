import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canEditItemFields, canRenameItem } from '../app/lib/item-edit-core'

/**
 * THE CARD'S NAME IS ANYONE'S ON THE TEAM TO FIX (the owner, 27 Nov 2026: "allow us to change the card name in post
 * approval anyone can do it so it reflects in the portal"). A post made on the Schedule is named after its file —
 * "133", "138" — and the client reads that name in their portal.
 */
describe('renaming a card', () => {
  it('every team role may rename; a client never', () => {
    for (const role of ['scheduler', 'editor', 'designer', 'account_manager', 'super_admin'] as const) {
      expect(canRenameItem({ role: role as never }), role).toBe(true)
    }
    expect(canRenameItem({ role: 'client' as never })).toBe(false)
  })

  it('the rest of a card still belongs to its holder or a manager', () => {
    const stranger = { id: 'u1', role: 'scheduler' as never }
    expect(canEditItemFields(stranger, { owner_id: 'someone-else' })).toBe(false)
  })

  it('the route lets a name-only change through for the team, and refuses a blank name', () => {
    const route = readFileSync('app/api/production/items/[id]/route.ts', 'utf8')
    expect(route).toContain("const titleOnly = keys.length === 1 && keys[0] === 'title'")
    expect(route).toContain('!(titleOnly && canRenameItem(user)) && !canEditItemFields(user, current)')
    expect(route).toContain("'Give the card a name'")
  })

  it('Post approval offers Rename to everyone, on a Schedule-made post too; the due date stays with a manager', () => {
    const ui = readFileSync('app/dashboard/board/PostApprovalDetail.tsx', 'utf8')
    expect(ui).toContain('{!editingHead && (')
    expect(ui).not.toContain('{!adhoc && isManager && !editingHead && (')
    expect(ui).toContain("{mayPlanHead ? 'Rename or set due date' : 'Rename'}")
    expect(ui).toContain('JSON.stringify(mayPlanHead ? { title, due_date: headDue || null } : { title })')
  })

  it('the post window on the Schedule renames too — that is where a Schedule-made post is opened', () => {
    const win = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(win).toContain('<PostName itemId={itemId} title={title} onRenamed=')
    const name = readFileSync('app/dashboard/social/schedule/PostName.tsx', 'utf8')
    expect(name).toContain("body: JSON.stringify({ title: name })")
    expect(name).toContain('/api/production/items/${itemId}')
  })
})
