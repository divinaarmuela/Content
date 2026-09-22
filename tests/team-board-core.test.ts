import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  boardClientName, boardStatusOf, cardCountWords, checkBoardTransition, cleanBoardName, cleanClientId, lanesOf, matchesBoardSearch,
  mayEditTeamBoard, mayManageTeamBoards, mayReviewTeamBoard, sortTeamBoards, statusAfterEdit, teamBoardLink, teamBoardPath,
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
  it('INSPO BOARDS FOR A CLIENT (22 Sep 2026): a board names its client or is the team’s own; the id is a plain id; the search reads the client too', () => {
    expect(cleanClientId('ae74e1e2-fc2d-48ab-948d-3d3e38aa628d')).toBe('ae74e1e2-fc2d-48ab-948d-3d3e38aa628d')
    expect(cleanClientId('none')).toBeNull()
    expect(cleanClientId('')).toBeNull()
    expect(cleanClientId(null)).toBeNull()
    expect(cleanClientId('has/slash')).toBeNull()
    expect(cleanClientId('a.b')).toBeNull()
    const clients = [{ id: 'c1', name: 'The Glass Den' }, { id: 'c2', name: '' }]
    expect(boardClientName({ client_id: 'c1' }, clients)).toBe('The Glass Den')
    expect(boardClientName({ client_id: 'c2' }, clients)).toBe('A client')
    expect(boardClientName({ client_id: 'gone' }, clients)).toBe('A client')
    expect(boardClientName({ client_id: null }, clients)).toBeNull()
    expect(matchesBoardSearch({ name: 'October ideas' }, 'Divina', 'glass', 'The Glass Den')).toBe(true)
    expect(matchesBoardSearch({ name: 'October ideas' }, 'Divina', 'glass', null)).toBe(false)
  })
  it('THE STAGES (22 Sep 2026): Inspo → Quality check → Approved, or back with a note — the brief flow with fewer columns', () => {
    const editor = { id: 'e', role: 'editor' }, checker = { id: 'q', role: 'quality_checker' }, am = { id: 'a', role: 'account_manager' }, client = { id: 'c', role: 'client' }
    expect(boardStatusOf({ status: null })).toBe('draft')
    expect(boardStatusOf({ status: 'nonsense' })).toBe('draft')
    expect(boardStatusOf({ status: 'approved' })).toBe('approved')
    expect(boardStatusOf(undefined)).toBe('draft')
    // who decides
    expect(mayReviewTeamBoard(checker)).toBe(true); expect(mayReviewTeamBoard(am)).toBe(true); expect(mayReviewTeamBoard({ id: 's', role: 'super_admin' })).toBe(true)
    expect(mayReviewTeamBoard(editor)).toBe(false); expect(mayReviewTeamBoard(client)).toBe(false); expect(mayReviewTeamBoard(null)).toBe(false)
    // sending in: anyone on the team, from Inspo or from Changes asked
    expect(checkBoardTransition(editor, 'draft', 'quality_check')).toEqual({ ok: true, note: null })
    expect(checkBoardTransition(editor, 'changes_requested', 'quality_check')).toEqual({ ok: true, note: null })
    expect(checkBoardTransition(editor, 'quality_check', 'quality_check').ok).toBe(false)
    expect(checkBoardTransition(editor, 'approved', 'quality_check').ok).toBe(false)
    expect(checkBoardTransition(client, 'draft', 'quality_check').ok).toBe(false)
    // deciding: the checker or a manager, only from the check; changes need a note
    expect(checkBoardTransition(checker, 'quality_check', 'approved')).toEqual({ ok: true, note: null })
    expect(checkBoardTransition(am, 'quality_check', 'changes_requested', '  the second row is off brand ')).toEqual({ ok: true, note: 'the second row is off brand' })
    expect(checkBoardTransition(checker, 'quality_check', 'changes_requested', '   ')).toEqual({ ok: false, error: 'Say what should change' })
    expect(checkBoardTransition(editor, 'quality_check', 'approved').ok).toBe(false)
    expect(checkBoardTransition(checker, 'draft', 'approved').ok).toBe(false)
    expect(checkBoardTransition(checker, 'quality_check', 'draft').ok).toBe(false)
    expect(checkBoardTransition(checker, 'quality_check', 'published').ok).toBe(false)
    expect(checkBoardTransition(checker, 'quality_check', 'changes_requested', 'x'.repeat(2000))).toMatchObject({ ok: true, note: 'x'.repeat(1000) })
    // an approved board worked on again is back at Inspo
    expect(statusAfterEdit('approved')).toBe('draft')
    expect(statusAfterEdit('quality_check')).toBe('quality_check')
    // the columns, every stage drawn, in the flow's order
    const lanes = lanesOf([{ status: 'approved' }, { status: null }, { status: 'quality_check' }, { status: 'draft' }])
    expect(lanes.map(l => [l.status, l.label, l.boards.length])).toEqual([['draft', 'Inspo', 2], ['quality_check', 'Quality check', 1], ['changes_requested', 'Changes asked', 0], ['approved', 'Approved', 1]])
  })
  it('the routes take a client and a stage: a client must exist and a manager sets it; the stage is decided inside the claim; the pages draw the client, the lanes and the buttons; Boards sits under Shoots', () => {
    const list = readFileSync('app/api/production/team-boards/route.ts', 'utf8')
    expect(list).toContain("if (client_id && !(await table<Client>('clients').get(client_id))) {")
    expect(list).toContain("name, client_id, status: 'draft', canvas_cards: [],")
    const one = readFileSync('app/api/production/team-boards/[id]/route.ts', 'utf8')
    expect(one).toContain("return NextResponse.json({ error: 'Only an account manager or a super admin says which client a board is for' }, { status: 403 })")
    expect(one).toContain('const step = checkBoardTransition(user, from, to, body.note)')
    expect(one).toContain('const after = statusAfterEdit(from)')
    expect(one).toContain("if (refused) return NextResponse.json({ error: refused }, { status: String(refused).startsWith('Only') || String(refused).startsWith('Say which') ? 403 : 409 })")
    const listPage = readFileSync('app/dashboard/team-boards/page.tsx', 'utf8')
    expect(listPage).toContain('const lanes = useMemo(() => lanesOf(boards), [boards])')
    expect(listPage).toContain('{client ?? INTERNAL_BOARD_WORD}')
    expect(listPage).toContain("body: JSON.stringify({ name, client_id: newClient === NO_CLIENT ? null : newClient }),")
    expect(listPage).toContain("body: JSON.stringify({ name, client_id: editClient === NO_CLIENT ? null : editClient }),")
    const page = readFileSync('app/dashboard/team-boards/[id]/page.tsx', 'utf8')
    expect(page).toContain("void patch({ status: 'quality_check' }, 'Sent to the quality check')")
    expect(page).toContain("void patch({ status: 'approved' }, 'Board approved')")
    expect(page).toContain("void patch({ status: 'changes_requested', note }, 'Sent back with your note')")
    expect(page).toContain("void patch({ client_id: v === NO_CLIENT ? null : v }")
    // the rail: Boards right under Shoots, in the main list (22 Sep 2026: "place the boards page up higher, near the Shoots link")
    const shell = readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')
    const shoots = shell.indexOf("{ href: '/dashboard/production', label: 'Shoots',")
    const boards = shell.indexOf("{ href: '/dashboard/team-boards',   label: 'Boards',")
    const editor = shell.indexOf("{ href: '/dashboard/editor',     label: 'Editor',")
    expect(shoots).toBeGreaterThan(-1)
    expect(boards).toBeGreaterThan(shoots)
    expect(boards).toBeLessThan(editor)
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
