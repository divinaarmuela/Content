import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  cardCountWords, cleanBoardName, matchesBoardSearch, mayEditTeamBoard, mayManageTeamBoards, sortTeamBoards, teamBoardLink, teamBoardPath,
} from '../app/lib/team-board-core'
import { canSeePage } from '../app/lib/page-access-core'

describe('team boards (21 Sep 2026)', () => {
  it('a manager makes, renames and deletes; anyone on the team works on one; a client neither', () => {
    expect(mayManageTeamBoards({ id: 'a', role: 'account_manager' })).toBe(true)
    expect(mayManageTeamBoards({ id: 'a', role: 'super_admin' })).toBe(true)
    for (const role of ['editor', 'scheduler', 'general', 'quality_checker', 'client']) expect(mayManageTeamBoards({ id: 'a', role })).toBe(false)
    for (const role of ['editor', 'scheduler', 'general', 'quality_checker', 'account_manager', 'super_admin']) expect(mayEditTeamBoard({ id: 'a', role })).toBe(true)
    expect(mayEditTeamBoard({ id: 'a', role: 'client' })).toBe(false)
    expect(mayEditTeamBoard(null)).toBe(false)
  })
  it('the link a person copies is the board’s own dashboard address', () => {
    expect(teamBoardPath('b1')).toBe('/dashboard/team-boards/b1')
    expect(teamBoardLink('https://app.mdmmarketing.com.au/', 'b1')).toBe('https://app.mdmmarketing.com.au/dashboard/team-boards/b1')
  })
  it('names are cleaned, cards are counted without their arrows, the last worked-on leads, and the search reads the name and the maker', () => {
    expect(cleanBoardName('  October   ideas \n')).toBe('October ideas')
    expect(cleanBoardName('   ')).toBeNull()
    expect(cleanBoardName('x'.repeat(200))!.length).toBe(80)
    expect(cardCountWords([])).toBe('Empty')
    expect(cardCountWords([{ kind: 'note' }])).toBe('1 card')
    expect(cardCountWords([{ kind: 'note' }, { kind: 'image' }, { kind: 'arrow' }])).toBe('2 cards')
    expect(sortTeamBoards([{ updated_at: '2026-09-01' }, { updated_at: '2026-09-20' }, { created_at: '2026-09-10' }]).map(b => b.updated_at ?? b.created_at)).toEqual(['2026-09-20', '2026-09-10', '2026-09-01'])
    expect(matchesBoardSearch({ name: 'October ideas' }, 'Divina', 'octo')).toBe(true)
    expect(matchesBoardSearch({ name: 'October ideas' }, 'Divina', 'divi')).toBe(true)
    expect(matchesBoardSearch({ name: 'October ideas' }, 'Divina', 'xyz')).toBe(false)
  })
  it('every team role sees Boards by default; a client does not', () => {
    for (const role of ['editor', 'scheduler', 'general', 'quality_checker', 'account_manager', 'super_admin'] as const) expect(canSeePage(role, '/dashboard/team-boards', [])).toBe(true)
    expect(canSeePage('client', '/dashboard/team-boards', [])).toBe(false)
  })
  it('the routes take the team and refuse a client; making, renaming and deleting are a manager’s; an edit merges inside a claim; both pages copy the link', () => {
    const list = readFileSync('app/api/production/team-boards/route.ts', 'utf8')
    expect(list).toContain("await requireRole('scheduler') // any team role; excludes `client`")
    expect(list).toContain("if (!mayManageTeamBoards(user)) {")
    const one = readFileSync('app/api/production/team-boards/[id]/route.ts', 'utf8')
    expect(one).toContain("const result = await table<TeamBoard>('team_boards').claim(id, ((cur: TeamBoard | null): unknown => {")
    expect(one).toContain('canvas_cards: applyCanvasOp((cur as { canvas_cards?: unknown }).canvas_cards, op)')
    expect(one).toContain("return NextResponse.json({ error: 'Only an account manager or a super admin renames a board' }, { status: 403 })")
    expect(one).toContain("return NextResponse.json({ error: 'Only an account manager or a super admin deletes a board' }, { status: 403 })")
    for (const f of ['app/dashboard/team-boards/page.tsx', 'app/dashboard/team-boards/[id]/page.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src).toContain('Copy board link')
      expect(src).toContain('teamBoardLink(window.location.origin,')
    }
    const page = readFileSync('app/dashboard/team-boards/[id]/page.tsx', 'utf8')
    expect(page).toContain('<BriefCanvas cards={cards} references={[]} canEdit={mayEditTeamBoard(me)} onOp={onOp} />')
    const shell = readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')
    expect(shell).toContain("{ href: '/dashboard/team-boards',   label: 'Boards',        icon: StickyNote },")
  })
})
