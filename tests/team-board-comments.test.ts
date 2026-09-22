import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  clientLinkWords, clientMaySeeTeamBoard, mayShareTeamBoard, portalTeamBoardLink, portalTeamBoardPath,
  teamBoardCommentPath, teamBoardCommentSubject,
} from '../app/lib/team-board-comments-core'

/**
 * COMMENTS ON A TEAM BOARD (the owner, 22 Sep 2026: "when we show to client,
 * can they leave comments, like how we do for shoot briefs" and "make sure
 * in the boards internal comments is possible too, like tagging").
 */
const am = { id: 'am1', role: 'account_manager' }
const admin = { id: 'sa1', role: 'super_admin' }
const editor = { id: 'ed1', role: 'editor' }
const client = { id: 'cl1', role: 'client' }

describe('where a board comment opens', () => {
  it('the team page, on the card when there is one', () => {
    expect(teamBoardCommentPath('b1', 'c1')).toBe('/dashboard/team-boards/b1?card=c1')
    expect(teamBoardCommentPath('b1', null)).toBe('/dashboard/team-boards/b1')
  })
  it('the client page, with the portal token — nothing new to keep secret', () => {
    expect(portalTeamBoardPath('tok', 'b1')).toBe('/portal/tok/team-board/b1')
    expect(portalTeamBoardPath('tok', 'b1', 'c1')).toBe('/portal/tok/team-board/b1?card=c1')
    expect(portalTeamBoardLink('https://app.example/', 'tok', 'b1')).toBe('https://app.example/portal/tok/team-board/b1')
  })
  it('the email subject names the board and the card', () => {
    expect(teamBoardCommentSubject('Glass den 1st shoot', 'Hero reel image')).toBe('Glass den 1st shoot — on: Hero reel image')
    expect(teamBoardCommentSubject('', null)).toBe('a board')
  })
  it('the words after copying say who to send it to', () => {
    expect(clientLinkWords('The Glass Den')).toContain('send it to The Glass Den')
    expect(clientLinkWords(null)).toBe('Client link copied')
  })
})

describe('who shares, who sees', () => {
  it('a manager shares a board that names a client; nobody shares the team’s own board', () => {
    expect(mayShareTeamBoard(am, { client_id: 'cl1' })).toBe(true)
    expect(mayShareTeamBoard(admin, { client_id: 'cl1' })).toBe(true)
    expect(mayShareTeamBoard(editor, { client_id: 'cl1' })).toBe(false)
    expect(mayShareTeamBoard(client, { client_id: 'cl1' })).toBe(false)
    expect(mayShareTeamBoard(am, { client_id: null })).toBe(false)
    expect(mayShareTeamBoard(am, null)).toBe(false)
  })
  it('the client sees their own board once it is shared — not before, never another client’s', () => {
    expect(clientMaySeeTeamBoard({ client_id: 'cl1', shared_with_client: true }, 'cl1')).toBe(true)
    expect(clientMaySeeTeamBoard({ client_id: 'cl1', shared_with_client: false }, 'cl1')).toBe(false)
    expect(clientMaySeeTeamBoard({ client_id: 'cl1' }, 'cl1')).toBe(false)
    expect(clientMaySeeTeamBoard({ client_id: 'cl2', shared_with_client: true }, 'cl1')).toBe(false)
    expect(clientMaySeeTeamBoard(null, 'cl1')).toBe(false)
  })
})

describe('the pages and routes are wired the same way as a shoot’s board', () => {
  const read = (f: string) => readFileSync(f, 'utf8')
  it('the team route: the same tag helpers as a shoot’s comments, a card required, the tagged told with a link to the card', () => {
    const s = read('app/api/production/team-boards/[id]/comments/route.ts')
    expect(s).toContain("import { notifyTagged, resolveTags, settleTagNotifications, taggableTeam } from '../../../../../lib/comment-tags'")
    expect(s).toContain('const tagged = resolveTags(body, explicit, await taggableTeam(), user.id)')
    expect(s).toContain("target: { kind: 'board', id, title: String(board.name ?? 'a board'), path: teamBoardCommentPath(id, card.id) }")
    expect(s).toContain("if (!mayEditTeamBoard(user)) return NextResponse.json({ error: 'Boards are the team’s' }, { status: 403 })")
    expect(s).toContain("board_id: id, author_id: user.id, body, card_id: card.id,")
  })
  it('a tag on a board emails a link that opens the board on the card', () => {
    const s = read('app/lib/comment-tags.ts')
    expect(s).toContain("target: { kind: 'item' | 'shoot' | 'board'; id: string; title: string; path?: string }")
    expect(s).toContain("? `${DASHBOARD_URL}${target.path ?? `/dashboard/team-boards/${target.id}`}`")
    expect(s).toContain("target.kind === 'item' ? OPEN_ITEM_CTA : target.kind === 'board' ? 'Open the board' : 'Open the shoot'")
  })
  it('the board page wraps its canvas in the comments, reads the rows live, and offers the client link to a manager', () => {
    const page = read('app/dashboard/team-boards/[id]/page.tsx')
    expect(page).toContain('<TeamBoardComments boardId={id} cards={cards} team={team}>')
    expect(page).toContain('{mayShareTeamBoard(me, board) && (')
    expect(page).toContain("const ok = board?.shared_with_client === true ? true : await patch({ shared_with_client: true }, 'Shared with the client')")
    expect(page).toContain('await navigator.clipboard.writeText(portalTeamBoardLink(window.location.origin, token, id))')
    const comments = read('app/dashboard/team-boards/[id]/TeamBoardComments.tsx')
    expect(comments).toContain("useTable<TeamBoardComment>('team_board_comments', { where, orderBy })")
    expect(comments).toContain('members={members}')
    expect(comments).toContain("new URLSearchParams(window.location.search).get('card')")
  })
  it('the panel offers "@" whenever the caller says who the team is — the client side never does', () => {
    const panel = read('app/components/canvas/CardCommentPanel.tsx')
    expect(panel).toContain('onSend: (body: string, mentionIds?: string[]) => Promise<boolean>')
    expect(panel).toContain('const ok = await onSend(body, members ? extractMentions(body, members).map(m => m.id) : undefined)')
    expect(panel.replace(/\r\n/g, '\n')).toContain('{members ? (\n          <MentionBox')
    const shoot = read('app/dashboard/production/shoots/[id]/BriefBoardComments.tsx')
    expect(shoot).toContain('members={members}')
    const board = read('app/components/portal/ShootBoard.tsx')
    expect(board).not.toContain('members={')
  })
  it('the client’s page and route: the same component, a team_board thread, only a shared board', () => {
    const page = read('app/portal/[token]/team-board/[id]/page.tsx')
    expect(page).toContain('thread="team_board"')
    expect(page).toContain("robots: 'noindex, nofollow'")
    const loader = read('app/lib/portal-team-board.ts')
    expect(loader).toContain('if (!clientMaySeeTeamBoard(board, client.id)) return null')
    const route = read('app/api/portal/comment/route.ts')
    expect(route).toContain("if (kind === 'team_board') {")
    expect(route).toContain("if (!clientMaySeeTeamBoard(board, client.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })")
    expect(route).toContain('dashboardPath: teamBoardCommentPath(b.id, card.id),')
    const board = read('app/components/portal/ShootBoard.tsx')
    expect(board).toContain("body: JSON.stringify({ token, kind: thread, id: shootId, card_id: openCard.id, body, author_name: who })")
  })
  it('sharing is decided inside the board’s claim, by a manager, on a board that names a client', () => {
    const s = read('app/api/production/team-boards/[id]/route.ts')
    expect(s).toContain("const share = 'shared_with_client' in body ? body.shared_with_client === true : null")
    expect(s).toContain('if (!mayShareTeamBoard(user, { client_id: (clientChange?.client_id ?? cur.client_id) ?? null })) {')
    expect(s).toContain('? { shared_with_client: true, client_shared_at: now, client_shared_by: user.id }')
  })
})
