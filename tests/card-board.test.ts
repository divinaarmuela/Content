import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The card carries its board.
 *
 * `ItemBoard` — the Milanote-style canvas behind a piece of work — was built
 * and then mounted nowhere: the owner opened a card and the board they had
 * asked for was not there. This pins the mount as a property of the source,
 * the way `drive-page-writes` does, so the component cannot silently become
 * dead code again.
 */

// the card's body — the page route is a thin wrapper around CardDetail
const CARD_PAGE = join(process.cwd(), 'app', 'dashboard', 'production', '[id]', 'CardDetail.tsx')
const DASHBOARD = join(process.cwd(), 'app', 'dashboard')

/** The code, without the prose about the code. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(name)) out.push(p)
  }
  return out
}

describe('the card carries its board', () => {
  const src = code(readFileSync(CARD_PAGE, 'utf8'))

  it('the card page imports ItemBoard', () => {
    expect(src).toMatch(/import ItemBoard from '[^']*boards\/ItemBoard'/)
  })

  it('the card page mounts ItemBoard with the item id and a way back to the card', () => {
    const mount = src.match(/<ItemBoard\b[^>]*\/>/)
    expect(mount, 'ItemBoard is imported but never rendered').not.toBeNull()
    expect(mount![0]).toMatch(/itemId=\{/)
    expect(mount![0]).toMatch(/backHref=\{/)
  })

  it('the board is headed in plain words on the page the person is already on', () => {
    expect(src).toMatch(/title="Board"/)
  })

  it('ItemBoard is mounted somewhere in the dashboard, not only defined', () => {
    const mounts = walk(DASHBOARD)
      .filter(p => !p.endsWith(join('boards', 'ItemBoard.tsx')))
      .filter(p => /<ItemBoard\b/.test(code(readFileSync(p, 'utf8'))))
    expect(mounts.length).toBeGreaterThan(0)
  })
})
