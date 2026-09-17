import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The board draws the page's LANES (`pageLanes`), not a flat column list:
 * Editor and Scheduler give room to the stages that person works and fold
 * the rest into one narrow lane. This pins the parts of that which only the
 * source can show — the pages name their page, the folded lane is compact,
 * and a folded lane is a quieter, narrower column.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

describe('the three pages hand the board their page, and the board makes the lanes', () => {
  // Shoots (production) no longer draws the work board at all — it is one
  // card per shoot in the playbook's own columns (11 Sep 2026)
  it.each([
    ['app/dashboard/editor/page.tsx', 'editor'],
    ['app/dashboard/scheduler/page.tsx', 'scheduler'],
  ])('%s says page="%s" and passes no column list', (rel, page) => {
    const src = code(read(rel))
    expect(src).toContain(`page="${page}"`)
    expect(src).not.toMatch(/columns=\{/)
    expect(src).not.toMatch(/pageColumns/)
    // Posted keeps the last two weeks: every page passes today into pageCards
    expect(src).toMatch(/pageCards\('(editor|scheduler)', rows, viewer, today\)/)
  })

  it('the board groups by lane, drops on lanes, and maps a column deep link to its lane', () => {
    const board = code(read('app/dashboard/board/Board.tsx'))
    expect(board).toMatch(/groupByLane\(laneLayout, shown\)/)
    expect(board).toMatch(/dropOnLane\(card, lane, viewer\)/)
    expect(board).toMatch(/initialLane=\{initialColumn \? laneOf\(page, initialColumn\) : undefined\}/)
    // a folded lane's cards are compact; a full lane's are the real card
    expect(board).toMatch(/lane\.folded \? \(\s*<CompactCard/)
    // the footer under Posted
    expect(board).toMatch(/holdsPosted && inLane\.length > 0 \? \(\s*<p[^>]*>\{OLDER_POSTS_NOTE\}<\/p>/)
  })

  it('a folded lane is quieter, not narrower — no rail, no sideways words', () => {
    const lanes = code(read('app/dashboard/production/LaneBoard.tsx'))
    // every lane the same width — never a fixed narrow one beside stretching neighbours
    expect(lanes).not.toMatch(/flex-none/)
    // five lanes + gaps must fit a laptop's board width
    // 248 since 13 Sep 2026 ("everything looks cramped on the laptop"): the board scrolls sideways instead
    expect(lanes).toMatch(/className="min-w-\[248px\] flex-1"/)
    expect(lanes).toMatch(/muted=\{lane\.folded\}/)
    // the rail read as a broken sliver on the page: it is gone, and with it
    // the sideways title and the collapse toggle
    expect(lanes).not.toMatch(/writing-mode:vertical/)
    expect(lanes).not.toMatch(/w-11 min-w-11/)
    expect(lanes).not.toMatch(/onToggle/)
  })

  it('the compact card is one line — title, client, stage — with no button of its own', () => {
    const card = code(read('app/dashboard/board/BoardCard.tsx'))
    const compact = card.slice(card.indexOf('export function CompactCard'), card.indexOf('export function BoardCard'))
    expect(compact.length).toBeGreaterThan(100)
    expect(compact).toMatch(/min-h-11/)
    expect(compact).toMatch(/\{lines\.title\}/)
    expect(compact).toMatch(/\{lines\.client\}/)
    // …the stage, or "Handed to …" once a scheduler holds the card (17 Sep 2026)
    expect(compact).toMatch(/: lines\.stage\}/)
    expect(compact).not.toMatch(/cardActions|DropdownMenu|onAction/)
  })
})

describe('the lanes show a scrollbar (13 Sep 2026)', () => {
  it('the lane scroller is marked, and the stylesheet draws a bar for it despite hiding every other one', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    expect(readFileSync('app/dashboard/production/LaneBoard.tsx', 'utf8')).toMatch(/className="w-full overflow-x-auto" data-lane-scroll/)
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/\.dbx \[data-lane-scroll\]::-webkit-scrollbar \{ display: block; height: 10px; \}/)
    expect(css).toMatch(/\.dbx \[data-lane-scroll\] \{ scrollbar-width: thin/)
  })
  it('the dashboard’s root is not clipped, so a Radix scroll lock cannot unstick a sticky rail (the shoot page, 15 Sep 2026)', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/^html \{ scroll-behavior: smooth; overflow-x: clip; max-width: 100%; \}$/m)
    expect(css).toMatch(/^html:has\(\.dbx\) \{ overflow-x: visible; \}$/m)
  })
})
