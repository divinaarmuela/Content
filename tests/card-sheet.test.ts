import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE CARD SLIDES IN FROM THE RIGHT.
 *
 * A press on a board card opens it BESIDE the board, in a panel, with the
 * board still live behind it — it no longer navigates away. The panel is
 * the same `CardDetail` the full page draws, on the same live listeners,
 * with the same conversation. This reads the source, the way
 * `card-page-reset.test.ts` does, so a card that goes back to being a link,
 * or a sheet that fetches the row once instead of listening, fails here.
 */

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
/** the code, without the prose about the code */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !/^\s*\/\//.test(l))
  .join('\n')

const BOARD_CARD = 'app/dashboard/board/BoardCard.tsx'
const BOARD = 'app/dashboard/board/Board.tsx'
const WORK_CARD = 'app/dashboard/ui/WorkCard.tsx'
const SHEET = 'app/dashboard/board/CardSheet.tsx'
const DETAIL = 'app/dashboard/production/[id]/CardDetail.tsx'
const PAGES = [
  'app/dashboard/production/page.tsx',
  'app/dashboard/editor/page.tsx',
  'app/dashboard/scheduler/page.tsx',
]

describe('a board card opens the sheet instead of navigating', () => {
  const card = code(read(BOARD_CARD))

  it('BoardCard takes onOpen and gives WorkCard no href', () => {
    expect(card).toMatch(/onOpen: \(card: BoardViewCard\) => void/)
    expect(card).toMatch(/<WorkCard\s+onOpen=\{\(\) => onOpen\(card\)\}/)
    expect(card).not.toContain('href={`/dashboard/production/')
  })

  it('WorkCard draws a real button when given onOpen — Enter and Space open it', () => {
    const wc = code(read(WORK_CARD))
    expect(wc).toContain('onOpen?: () => void')
    expect(wc).toMatch(/<button type="button" aria-label=\{title\} onClick=\{onOpen\}/)
    expect(wc).toMatch(/role="button"/)
    expect(wc).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/)
  })

  it('the board passes every card its onOpen, and a drag is never a press', () => {
    const board = code(read(BOARD))
    expect(board).toMatch(/onOpen: \(card: BoardCardRow\) => void/)
    expect(board).toContain('onOpen={open}')
    expect(board).toContain('justDragged.current = true')
    expect(board).toMatch(/if \(justDragged\.current\) return/)
  })

  it('the card page route still works — CardDetail on its own page', () => {
    const route = code(read('app/dashboard/production/[id]/page.tsx'))
    expect(route).toMatch(/<CardDetail id=\{id\} layout="page" \/>/)
  })
})

describe('the three boards host the sheet, and the address carries the card', () => {
  for (const page of PAGES) {
    it(`${page} opens cards in CardSheet`, () => {
      const src = code(read(page))
      expect(src).toContain("from '../board/CardSheet'")
      expect(src).toContain('useCardSheet()')
      expect(src).toMatch(/onOpen=\{c => sheet\.open\(c\.id\)\}/)
      expect(src).toMatch(/<CardSheet id=\{sheet\.cardId\} onClose=\{sheet\.close\} \/>/)
    })
  }

  it('the Production list rows open the sheet too', () => {
    const src = code(read('app/dashboard/production/page.tsx'))
    expect(src).toMatch(/onOpen=\{\(\) => sheet\.open\(t\.id\)\}/)
    expect(src).not.toContain('href={`/dashboard/production/${t.id}`}')
  })

  it('the hook writes ?card= with replaceState and reads it back', () => {
    const src = code(read(SHEET))
    expect(src).toContain("from '../../lib/card-sheet-core'")
    expect(src).toContain('readCardParam(window.location.search)')
    expect(src).toContain('window.history.replaceState(')
    expect(src).toContain('withCardParam(window.location.href, id)')
    expect(src).not.toContain('router.push')
  })
})

describe('the sheet is CardDetail, live, with the conversation in it', () => {
  const sheet = code(read(SHEET))
  const detail = code(read(DETAIL))

  it('renders CardDetail in its sheet layout, from the right, 560px on a desk', () => {
    expect(sheet).toMatch(/<CardDetail key=\{id\} id=\{id\} layout="sheet" onClose=\{onClose\} \/>/)
    expect(sheet).toContain('side="right"')
    expect(sheet).toContain('sm:max-w-[560px]')
    expect(sheet).toContain('hideClose')
  })

  it('swipes shut on a phone, past the threshold and only sideways', () => {
    expect(sheet).toContain('onTouchStart={onTouchStart}')
    expect(sheet).toContain('onTouchEnd={onTouchEnd}')
    expect(sheet).toContain('isDismissSwipe(')
  })

  it('subscribes to the row, the comments and the versions — never a one-shot fetch for them', () => {
    expect(detail).toContain("useRow<ContentItem>('content_items', id)")
    expect(detail).toContain("useTable<ItemComment>('item_comments', { by: byItem })")
    expect(detail).toContain("useTable<AssetVersion>('asset_versions', { by: byItem })")
    // the comments the thread draws are the listener's rows
    expect(detail).toMatch(/const comments = \[\.\.\.commentRows\]/)
    expect(detail).not.toMatch(/fetch\(`\/api\/production\/items\/\$\{id\}\/comments`,\s*\{\s*cache/)
    expect(detail).not.toMatch(/fetch\([^)]*\/comments`\)\s*\.then/)
  })

  it('the composer is inside the sheet — same MentionBox, same route as the page', () => {
    // one composer, drawn once, used by both layouts
    expect(detail).toMatch(/const composer = \(/)
    expect(detail).toContain('<MentionBox')
    expect(detail).toContain('/api/production/items/${id}/comments')
    const sheetBranch = detail.slice(detail.indexOf('if (inSheet) {'), detail.indexOf('THE PAGE'))
    expect(sheetBranch).toContain('{composer}')
    expect(sheetBranch).toContain('{commentThread}')
    expect(sheetBranch).toContain("'All activity'")
  })

  it('the top bar carries the one move, copy link, open full page, More and a 44px close', () => {
    const sheetBranch = detail.slice(detail.indexOf('if (inSheet) {'), detail.indexOf('THE PAGE'))
    expect(sheetBranch).toContain('press(primaryMove)')
    expect(sheetBranch).toContain('aria-label="Copy link to this card"')
    expect(sheetBranch).toContain('aria-label="Open full page"')
    expect(sheetBranch).toContain('aria-label="More for this card"')
    expect(sheetBranch).toContain('aria-label="Close"')
    expect(sheetBranch).toContain("const iconBtn = 'h-11 w-11")
    // the facts, one line each
    for (const f of ["'Assignee'", "'Due date'", "'Client'", "'Kind'", "'Version'", "'Link'"]) {
      expect(sheetBranch).toContain(`factRow(${f}`)
    }
    expect(sheetBranch).toContain('What needs doing')
    expect(sheetBranch).toContain('{boardSection}')
    expect(sheetBranch).toContain('{filesSection}')
  })

  it('shuts the sheet instead of navigating when the card is gone or deleted', () => {
    expect(detail).toMatch(/if \(inSheet\) onClose\?\.\(\)\s*\n\s*else router\.push\('\/dashboard\/editor'\)/)
    expect(detail).toMatch(/if \(inSheet\) onClose\?\.\(\)\s*\n\s*else router\.push\(back\.href\)/)
  })
})
