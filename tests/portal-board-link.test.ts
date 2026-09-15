import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * JUST THE BOARD (the owner, 13 Sep 2026): a board-only portal page and a
 * "Copy board link" button on the shoot page. Source-pinned: the page draws
 * the canvas and the thread and nothing else from the plan; the button
 * builds the board URL from the same client token and turns the portal
 * switch on first, or the link would 404 for the client.
 */

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const PAGE = 'app/portal/[token]/board/[id]/page.tsx'
const SOP = 'app/dashboard/production/shoots/[id]/ShootSop.tsx'

describe('the board-only portal page', () => {
  const s = src(PAGE)
  it('is the same loader and the same comments as the portal shoot page — the team reads them on the shoot page', () => {
    expect(s).toMatch(/getPortalShootDetail\(raw, id\)/)
    expect(s).toMatch(/<ShootBoard[\s\S]*surface=\{\{ token \}\}/)
    // comments are ON A CARD (the board's bubbles), never a general box
    expect(s).not.toContain('CommentThread')
    expect(s).toMatch(/notFound\(\)/)
  })
  it('draws the board and the MD Media header, and nothing else from the plan', () => {
    expect(s).toMatch(/MDLogo-trim\.png/)
    expect(s).toMatch(/portal\.client\.name/)
    for (const notHere of ['PortalCardView', 'Download the plan PDF', 'Approve', 'objective', 'shot_list']) {
      expect(s, notHere).not.toContain(notHere)
    }
  })
  it('says so when the board is empty rather than drawing nothing', () => {
    expect(s).toMatch(/Nothing on the board yet/)
  })
  it('is not indexed', () => {
    expect(s).toMatch(/robots: 'noindex, nofollow'/)
  })
})

describe('Copy board link on the shoot page', () => {
  const s = src(SOP)
  it('builds the board URL from the portal token and the shoot id', () => {
    // the portal link is the business's, or — for a shoot made for one of
    // the client's people — that person's own (15 Sep 2026); the board rides on it
    expect(s).toMatch(/if \(!forWho\) return `\$\{window\.location\.origin\}\/portal\/\$\{portalToken\}`/)
    expect(s).toMatch(/navigator\.clipboard\.writeText\(`\$\{link\}\/board\/\$\{batch\.id\}`\)/)
    expect(s).toContain('Copy board link')
  })
  it('is drawn only once the plan is on the portal, and turns the board on before copying', () => {
    // the links live in the on-portal state of the one client block (13 Sep
    // 2026) — so the plan is already on the portal when the button exists
    expect(s).toMatch(/const onPortal = !!batch\.shared_with_client/)
    expect(s).toMatch(/data-client-on-portal/)
    // and the board's own switch, which an older page could have turned off
    expect(s).toMatch(/boardOff \? onPatch\('share_board', true\)/)
  })
})

describe('a viewer’s canvas carries no editing hints', () => {
  it('the “Double-click…” hints are drawn only when the card can be updated (the client saw one on 13 Sep 2026)', () => {
    const s = src('app/dashboard/production/shoots/[id]/CanvasCard.tsx')
    expect(s).toMatch(/\{onUpdate && <span className="opacity-50">Double-click to write a caption…<\/span>\}/)
    expect(s).toMatch(/onUpdate \? 'Double-click to name this section' : ''/)
  })
})
