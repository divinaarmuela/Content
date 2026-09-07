import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The board draws the page's LANES (`pageLanes`), not a flat column list:
 * Editor and Scheduler give room to the stages that person works and fold
 * the rest into one narrow lane. This pins the parts of that which only the
 * source can show — the pages name their page, the folded lane is compact,
 * collapses to a 44px rail, and the choice is remembered per page.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

describe('the three pages hand the board their page, and the board makes the lanes', () => {
  it.each([
    ['app/dashboard/production/page.tsx', 'production'],
    ['app/dashboard/editor/page.tsx', 'editor'],
    ['app/dashboard/scheduler/page.tsx', 'scheduler'],
  ])('%s says page="%s" and passes no column list', (rel, page) => {
    const src = code(read(rel))
    expect(src).toContain(`page="${page}"`)
    expect(src).not.toMatch(/columns=\{/)
    expect(src).not.toMatch(/pageColumns/)
    // Posted keeps the last two weeks: every page passes today into pageCards
    expect(src).toMatch(/pageCards\('(production|editor|scheduler)', rows, viewer, today\)/)
  })

  it('the board groups by lane, drops on lanes, and maps a column deep link to its lane', () => {
    const board = code(read('app/dashboard/board/Board.tsx'))
    expect(board).toMatch(/groupByLane\(laneLayout, shown\)/)
    expect(board).toMatch(/dropOnLane\(card, lane, viewer\)/)
    expect(board).toMatch(/initialLane=\{initialColumn \? laneOf\(page, initialColumn\) : undefined\}/)
    // a folded lane's cards are compact; a full lane's are the real card
    expect(board).toMatch(/lane\.folded \? \(\s*<CompactCard/)
    // the collapse is remembered per page
    expect(board).toMatch(/localStorage\.getItem\(FOLD_KEY\(page\)\)/)
    expect(board).toMatch(/localStorage\.setItem\(FOLD_KEY\(page\)/)
    // the footer under Posted
    expect(board).toMatch(/holdsPosted \? \(\s*<p[^>]*>\{OLDER_POSTS_NOTE\}<\/p>/)
  })

  it('a folded lane is ~200px, collapses to a 44px rail with the count, and its chevron is a 44px target', () => {
    const lanes = code(read('app/dashboard/production/LaneBoard.tsx'))
    expect(lanes).toMatch(/w-\[200px\] min-w-\[200px\] flex-none/)
    expect(lanes).toMatch(/w-11 min-w-11/)
    expect(lanes).toMatch(/aria-label=\{`Show \$\{lane\.title\} — \$\{lane\.count\}/)
    expect(lanes).toMatch(/h-11 w-11/)
    expect(lanes).toMatch(/muted=\{lane\.folded\}/)
  })

  it('the compact card is one line — title, client, stage — with no button of its own', () => {
    const card = code(read('app/dashboard/board/BoardCard.tsx'))
    const compact = card.slice(card.indexOf('export function CompactCard'), card.indexOf('export function BoardCard'))
    expect(compact.length).toBeGreaterThan(100)
    expect(compact).toMatch(/min-h-11/)
    expect(compact).toMatch(/\{lines\.title\}/)
    expect(compact).toMatch(/\{lines\.client\}/)
    expect(compact).toMatch(/\{lines\.stage\}/)
    expect(compact).not.toMatch(/cardActions|DropdownMenu|onAction/)
  })
})
