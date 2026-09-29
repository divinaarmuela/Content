import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE POST APPROVAL PAGE, pinned from its source (the same style as
 * tests/drive-page-writes.test.ts). The pure rules are pinned in
 * post-board-core.test.ts and post-waiting-core.test.ts; this holds the page to
 * them, so a second way of deciding where a post is, or a button that did not
 * come from `boardActions`, fails here rather than in a review.
 *
 * The audit's lesson (docs/posting-rebuild/AUDIT_EVIDENCE.md): the old page
 * worked a post's place out from the edit's status and the item's fields, in
 * several spots, so a card was drawn in one lane and acted on as another (B1),
 * "Sent to client" was printed for posts nobody sent (B4), and the drawer's
 * header contradicted the column (B5).
 */

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
/** the code, without the prose about the code */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

const BOARD_DIR = 'app/dashboard/scheduler/board'
const FILES = [
  'app/dashboard/scheduler/page.tsx',
  'app/dashboard/scheduler/WaitingOnYou.tsx',
  ...readdirSync(join(root, BOARD_DIR)).map(f => `${BOARD_DIR}/${f}`),
  'app/lib/post-board-core.ts',
  'app/lib/post-waiting-core.ts',
]

describe('one source of truth: the post’s stage', () => {
  it.each(FILES)('%s reads no second answer to where a post is', f => {
    const src = code(read(f))
    // the item's old post fields, and the edit's own stamps
    expect(src).not.toMatch(/posting_approval_state|posting_client_required|client_sent\b|delivered_at|client_round/)
    // the rules the rebuild retired
    expect(src).not.toMatch(/posting-approval-core|posting-approval['/]|post-to-client-core|postingColumn|mirrorStatus|sendStage/)
    // no card status places a post, and no post status either
    expect(src).not.toMatch(/\.status\s*===\s*'(pending|approved|scheduled|published|changes)'/)
  })

  it('the lanes are the stage, through groupPosts (laneOf)', () => {
    const core = code(read('app/lib/post-board-core.ts'))
    expect(core).toMatch(/pageLaneOf\(lanes, laneOf\(p\)\)/)
    const board = code(read(`${BOARD_DIR}/PostBoard.tsx`))
    expect(board).toMatch(/groupPosts\(/)
    expect(board).not.toMatch(/groupByLane|pageLanes|BOARD_COLUMNS/)
  })

  it('the page draws posts, never the board of edit cards', () => {
    const page = code(read('app/dashboard/scheduler/page.tsx'))
    expect(page).not.toMatch(/pageCards|<Board\b|from '\.\.\/board\/Board'/)
    expect(page).toMatch(/<PostBoard\b/)
    expect(page).toMatch(/usePostBoard\(viewer\)/)
  })

  it('posts are read through readPostState — a row without a stage is left off and counted, not placed', () => {
    const hook = code(read(`${BOARD_DIR}/usePostBoard.ts`))
    expect(hook).toMatch(/readPostState\(r as unknown as Record<string, unknown>\)/)
    expect(hook).toMatch(/else unstaged\+\+/)
  })
})

describe('buttons come from one list', () => {
  it('the card, the Move menu and a drop all use boardActions for the same post (audit B1)', () => {
    const board = code(read(`${BOARD_DIR}/PostBoard.tsx`))
    expect(board).toMatch(/const actions = boardActions\(bp\.post, bp\.hats, now, bp\.ctx\)/)
    expect(board).toMatch(/moves=\{postMoveTargets\(bp\.post, bp\.hats, now, bp\.ctx\)\}/)
    expect(board).toMatch(/const d = dropOnPostLane\(held\.post, laneKey, held\.hats, now, held\.ctx\)/)
    // a refused drop snaps back with the rule's reason
    expect(board).toMatch(/if \(!d\.ok\) \{ toast\.error\(d\.reason\); return \}/)
  })

  it('Waiting on you presses the same handler as the board', () => {
    const page = code(read('app/dashboard/scheduler/page.tsx'))
    expect(page).toMatch(/<WaitingOnYou rows=\{waiting\} busyId=\{acts\.busyId\} errorFor=\{acts\.errorFor\} onPress=\{acts\.press\} \/>/)
    expect(page).toMatch(/onPress=\{acts\.press\}\s+initialLane/)
  })

  it('a stopped button is drawn disabled, with its reason beside it — never hidden', () => {
    const card = code(read(`${BOARD_DIR}/PostCard.tsx`))
    expect(card).toMatch(/disabled=\{busy \|\| !!blockedPrimary\}/)
    expect(card).toMatch(/\{error \?\? blockedPrimary\}/)
    expect(card).not.toMatch(/reviewOnly/)
  })
})

describe('one route, and the server’s words', () => {
  it('every press is one request to the act route, with the rev the page drew', () => {
    const acts = code(read(`${BOARD_DIR}/usePostActs.tsx`))
    expect(acts).toMatch(/postAct\(post\.id, body\)/)
    // ONE client call to the act route: the board, Schedule and the post window all use post-act-contract's postAct
    for (const f of [`${BOARD_DIR}/usePostActs.tsx`, 'app/dashboard/social/schedule/page.tsx', 'app/dashboard/social/schedule/post-window-api.ts']) {
      expect(read(f), f).not.toMatch(/fetch\(postActPath/)
    }
    expect(acts).toMatch(/expect_rev: post\.rev/)
    // the version the person looked at rides with every versioned move
    expect(acts).toMatch(/row\.versioned && post\.sent_version != null \? \{ version: post\.sent_version \}/)
    // no other route moves a post from this page
    for (const f of FILES) expect(code(read(f)), f).not.toMatch(/\/api\/production\/items\/[^`'"]*\/(transition|posting-approval|send-to-client)/)
  })

  it('the toast is the server’s words, from the stage the post LANDED in (audit B9)', () => {
    const acts = code(read(`${BOARD_DIR}/usePostActs.tsx`))
    expect(acts).toMatch(/toast\.success\(json\.words[,)]/)
    expect(acts).not.toMatch(/now in \$\{/)
  })

  it('a client send carries the addresses picked from the client’s own list', () => {
    const acts = code(read(`${BOARD_DIR}/usePostActs.tsx`))
    expect(acts).toMatch(/extra\.send_to = picks/)
    expect(acts).toMatch(/choicesFor\(post\)/)
    expect(acts).toMatch(/const \{ choicesFor \} = deps/)
  })

  it('this page never books: no Book in, Post now or Change time is pressed here (decision 1)', () => {
    for (const f of FILES) expect(code(read(f)), f).not.toMatch(/'(book|post_now|change_time|unbook)'/)
  })
})

describe('the words are true', () => {
  it('"Sent to client" is only ever the face’s send line (audit B4, B16)', () => {
    for (const f of FILES.filter(f => f.endsWith('.tsx'))) {
      expect(code(read(f)), f).not.toMatch(/Sent to client/)
    }
    const card = code(read(`${BOARD_DIR}/PostCard.tsx`))
    expect(card).toMatch(/\{face\.sent && /)
  })

  it('a manager’s approval for the client is never worded "Client approved"', () => {
    for (const f of FILES) expect(read(f), f).not.toMatch(/Client approved/)
  })
})
