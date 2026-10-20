import { describe, expect, it } from 'vitest'
import { archivePatch, archiveWords, byArchive, isArchived, notArchived } from '../app/lib/archive-core'

const live = { id: 'a', archived_at: null }
const old = { id: 'b', archived_at: '2026-10-20T04:00:00.000Z' }
const never: { id: string; archived_at?: string | null } = { id: 'c' }

describe('archive — shoots, work cards and boards (the owner, 20 Oct 2026)', () => {
  it('a row is archived only when stamped', () => {
    expect(isArchived(old)).toBe(true)
    expect(isArchived(live)).toBe(false)
    expect(isArchived(never)).toBe(false)
    expect(isArchived(null)).toBe(false)
  })

  it('the page shows the live rows; the Archived view only the archived ones', () => {
    expect(byArchive([live, old, never]).map(r => r.id)).toEqual(['a', 'c'])
    expect(byArchive([live, old, never], true).map(r => r.id)).toEqual(['b'])
  })

  it('the portal never shows an archived row', () => {
    expect(notArchived([live, old, never]).map(r => r.id)).toEqual(['a', 'c'])
  })

  it('archiving stamps when and who; bringing back clears both', () => {
    const at = new Date('2026-10-20T05:00:00.000Z')
    expect(archivePatch(true, 'u1', at)).toEqual({ archived_at: '2026-10-20T05:00:00.000Z', archived_by: 'u1' })
    expect(archivePatch(false, 'u1', at)).toEqual({ archived_at: null, archived_by: null })
  })

  it('says what it did, and that the client no longer sees it', () => {
    expect(archiveWords('shoot', false)).toEqual({ button: 'Archive', done: "Shoot archived — it is off this page and the client's portal" })
    expect(archiveWords('board', true).button).toBe('Bring back')
  })
})

import { readFileSync } from 'node:fs'
import { mayArchiveCard } from '../app/lib/archive-core'
import { clientMaySeeTeamBoard } from '../app/lib/team-board-comments-core'

const src = (p: string) => readFileSync(p, 'utf8')

describe('archive — who, and every place it hides from', () => {
  it("a card: managers and a general user, or the card's own editor or designer; never a scheduler or a client", () => {
    const card = { owner_id: 'ed', assigned_by: 'am' }
    expect(mayArchiveCard({ id: 'x', role: 'super_admin' }, card)).toBe(true)
    expect(mayArchiveCard({ id: 'x', role: 'account_manager' }, card)).toBe(true)
    expect(mayArchiveCard({ id: 'ed', role: 'editor' }, card)).toBe(true)
    expect(mayArchiveCard({ id: 'other', role: 'editor' }, card)).toBe(false)
    expect(mayArchiveCard({ id: 'x', role: 'scheduler' }, card)).toBe(false)
    expect(mayArchiveCard({ id: 'x', role: 'client' }, card)).toBe(false)
  })

  it('a board shared with the client is gone from their portal once archived', () => {
    const b = { client_id: 'c1', shared_with_client: true }
    expect(clientMaySeeTeamBoard(b, 'c1')).toBe(true)
    expect(clientMaySeeTeamBoard({ ...b, archived_at: '2026-10-20T00:00:00Z' }, 'c1')).toBe(false)
  })

  it('the server checks each kind, and the portal hides archived shoots, cards, posts and boards', () => {
    const route = src('app/api/production/archive/route.ts')
    expect(route).toContain('canManageBatch(user, b)')
    expect(route).toContain('mayArchiveCard(user, item)')
    expect(route).toContain('mayManageTeamBoards(user)')
    expect(src('app/lib/portal-data.ts')).toContain("where: r => !isArchived(r) && (r.shared_with_client === true")
    expect(src('app/lib/portal-data.ts')).toContain("where: r => !isArchived(r), orderBy: [['updated_at', 'desc']], limit: 300")
    expect(src('app/lib/portal-thread.ts')).toContain('!b.shared_with_client || isArchived(b)')
    expect(src('app/lib/portal-thread.ts')).toContain('isInternalKind(kind) || isArchived(item)')
    expect(src('app/lib/editing-portal.ts').match(/isArchived\(item\)/g)?.length).toBe(2)
    expect(src('app/lib/one-portal-schedule.ts')).toContain('isArchived(itemById.get(p.source_item_id))')
  })

  it('every page has its Archived view, and the live rows leave archived ones out', () => {
    for (const p of ['app/dashboard/production/page.tsx', 'app/dashboard/editor/page.tsx', 'app/dashboard/designer/page.tsx', 'app/dashboard/team-boards/page.tsx']) {
      expect(src(p)).toContain('<ArchivedToggle')
      expect(src(p)).toContain('<ArchivedList')
    }
    const hook = src('app/dashboard/useLiveWork.ts')
    expect(hook).toContain('const items = useMemo(() => byArchive(allItems), [allItems])')
    expect(hook).toContain('const batches = useMemo(() => byArchive(allBatches), [allBatches])')
  })
})
