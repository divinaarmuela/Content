import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cardThreads, cardWords, checkAnchor, inGeneralThread, onPlanWords } from '../app/lib/plan-comments-core'

// 29 Oct 2026, the owner: "same goes for boards for this comments part" — "shoots and boards almost the same just
// without the scripts". Select words on a board card, comment on exactly those, with replies and Resolve.
const board = {
  canvas_cards: [
    { id: 'n1', kind: 'note', x: 0, y: 0, w: 200, z: 1, text: 'Warm light, the studio at golden hour' },
    { id: 'h1', kind: 'note', x: 0, y: 0, w: 200, z: 1, html: '<p>Bold <b>words</b> &amp; more</p><p>line two</p>' },
    { id: 't1', kind: 'todo', x: 0, y: 0, w: 200, z: 1, name: 'Bring', items: [{ id: 'a', text: 'Reflector', done: false }] },
    { id: 'i1', kind: 'image', x: 0, y: 0, w: 200, z: 1, url: 'https://example.com/a.jpg', caption: 'This angle for the hero' },
  ],
}

describe('the words of a board card', () => {
  it('a note’s words, a rich note as plain words, a to-do’s name and rows, a picture’s caption', () => {
    expect(cardWords(board.canvas_cards[0] as never)).toBe('Warm light, the studio at golden hour')
    expect(cardWords(board.canvas_cards[1] as never)).toBe('Bold words & more\nline two')
    expect(cardWords(board.canvas_cards[2] as never)).toBe('Bring\nReflector')
    expect(cardWords(board.canvas_cards[3] as never)).toBe('This angle for the hero')
  })
  it('a comment is only on words still on that card', () => {
    expect(checkAnchor(board, 'card:n1', 'golden hour')).toEqual({ ok: true, part: 'card:n1', quote: 'golden hour' })
    expect(checkAnchor(board, 'card:i1', 'hero')).toMatchObject({ ok: true })
    expect(checkAnchor(board, 'card:n1', 'blue hour')).toMatchObject({ ok: false })
    expect(checkAnchor(board, 'card:gone', 'golden')).toMatchObject({ ok: false })
  })
})

describe('threads on a card', () => {
  const rows = [
    { id: 'a', created_at: '2026-10-29T01:00:00Z', body: 'Love this', card_id: 'n1', anchor_part: 'card:n1', anchor_quote: 'golden hour' },
    { id: 'b', created_at: '2026-10-29T02:00:00Z', body: 'Booked', card_id: 'n1', parent_id: 'a' },
    { id: 'c', created_at: '2026-10-29T00:30:00Z', body: 'Whole card', card_id: 'n1' },
    { id: 'd', created_at: '2026-10-29T00:10:00Z', body: 'Other card', card_id: 'i1' },
  ]
  it('every first comment on the card is a thread, its replies under it', () => {
    const t = cardThreads(rows, 'n1')
    expect(t.map(x => x.root.id)).toEqual(['c', 'a'])
    expect(t[1].replies.map(r => r.id)).toEqual(['b'])
  })
  it('the general thread keeps first comments and a card’s own; a reply and the plan’s words stay where they are drawn', () => {
    expect(rows.filter(inGeneralThread).map(r => r.id)).toEqual(['a', 'c', 'd'])
    expect(inGeneralThread({ anchor_part: 'objective' })).toBe(false)
    expect(onPlanWords({ anchor_part: 'objective' })).toBe(true)
    expect(onPlanWords({ parent_id: 'x', card_id: 'n1' })).toBe(false)
  })
})

describe('the doors', () => {
  it('the client’s door: words on that card only, a reply on its own card, Resolve on a shoot board and a team board', () => {
    const s = readFileSync('app/api/portal/comment/route.ts', 'utf8')
    expect(s).toContain("if ((kind === 'shoot' || kind === 'team_board') && body.action === 'resolve') {")
    expect(s).toContain('card_id: parentId ? (parentCard ?? null) : (card ? card.id : null),')
    expect(s).toContain("if (anchor?.ok && anchor.part !== `card:${card.id}`) return NextResponse.json({ error: 'Select the words on the card you are commenting on.' }, { status: 409 })")
    expect(s).toContain('parent.board_id !== b.id || parent.card_id !== card.id || parent.parent_id || !withRole || !clientMaySee(withRole as never)')
  })
  it('the team’s doors check the words too, and a reply sits on its first comment’s card', () => {
    expect(readFileSync('app/api/production/team-boards/[id]/comments/route.ts', 'utf8')).toContain('const anchor = checkAnchor(board as never, json.anchor_part ?? null, json.anchor_quote ?? null)')
    expect(readFileSync('app/api/production/batches/[id]/comments/route.ts', 'utf8')).toContain('card_id: parentId ? parentCard : (card ? card.id : null),')
  })
  it('one panel on all three boards: the card’s words to select, threads with Reply and Resolve', () => {
    const p = readFileSync('app/components/canvas/CardCommentPanel.tsx', 'utf8')
    expect(p).toContain('const threads = useMemo(() => cardThreads(comments, card.id), [comments, card.id])')
    expect(p).toContain('<div ref={wordsRef} data-card-words={card.id}')
    expect(p).toContain("const ok = await onSend(reply.trim(), undefined, { parent_id: t.root.id })")
    for (const f of ['app/components/portal/ShootBoard.tsx', 'app/dashboard/production/shoots/[id]/BriefBoardComments.tsx', 'app/dashboard/team-boards/[id]/TeamBoardComments.tsx']) {
      const s = readFileSync(f, 'utf8')
      expect(s).toContain('onResolve={resolve}')
      expect(s).toContain("anchor_part: `card:${openCard.id}`")
    }
  })
})
