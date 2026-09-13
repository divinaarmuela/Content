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
    expect(s).toMatch(/<CommentThread token=\{token\} kind="shoot" id=\{data\.shoot\.id\}/)
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
    expect(s).toMatch(/\/portal\/\$\{portalToken\}\/board\/\$\{batch\.id\}/)
    expect(s).toContain('Copy board link')
  })
  it('turns the portal switch on before copying, so the link works for the client', () => {
    expect(s).toMatch(/batch\.shared_with_client \? Promise\.resolve\(true\) : onPatch\('shared_with_client', true\)/)
  })
})
