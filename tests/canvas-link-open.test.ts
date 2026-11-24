import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cardLinkOf, opensOnClick } from '../app/lib/canvas-link-open-core'

const el = (matches: boolean) => ({ closest: () => (matches ? {} : null) })

describe('a link on the board opens its page (Manal, 20 Oct 2026)', () => {
  it("a link card's address and a post's own link — https only", () => {
    expect(cardLinkOf({ kind: 'link', url: 'https://www.instagram.com/reel/DI1rZvYxD47/' })).toBe('https://www.instagram.com/reel/DI1rZvYxD47/')
    expect(cardLinkOf({ kind: 'mockup', link_url: 'https://www.tiktok.com/@a/video/1' })).toBe('https://www.tiktok.com/@a/video/1')
    expect(cardLinkOf({ kind: 'mockup' })).toBeUndefined()
    expect(cardLinkOf({ kind: 'note', url: 'https://x.com' })).toBeUndefined()
    expect(cardLinkOf({ kind: 'link', url: 'javascript:alert(1)' })).toBeUndefined()
  })

  it('for someone only looking (a client), a plain click opens it; the play button, a drag and an edit do not', () => {
    expect(opensOnClick(el(false), { dragged: false, editing: false, viewOnly: true })).toBe(true)
    expect(opensOnClick(el(true), { dragged: false, editing: false, viewOnly: true })).toBe(false)
    expect(opensOnClick(el(false), { dragged: true, editing: false, viewOnly: true })).toBe(false)
    expect(opensOnClick(el(false), { dragged: false, editing: true, viewOnly: true })).toBe(false)
  })

  // THE OWNER, 25 Nov 2026: "when I click it accidentally it opens, why — it's a bad user experience"
  it('for someone who can edit the board, a click only selects the card — the link under it and Open link open it', () => {
    expect(opensOnClick(el(false), { dragged: false, editing: false, viewOnly: false })).toBe(false)
    const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    expect(canvas).toMatch(/<ExternalLink className="h-3\.5 w-3\.5" \/> Open link/)
  })

  it('opens in a new tab, called off by a double-click, and shows the link under the post as Milanote does', () => {
    const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    expect(canvas).toContain("window.open(url, '_blank', 'noopener,noreferrer')")
    expect(canvas).toMatch(/onDoubleClick=\{e => \{\s*e\.stopPropagation\(\)\s*cancelLinkOpen\(\)/)
    const card = readFileSync('app/dashboard/production/shoots/[id]/CanvasCard.tsx', 'utf8')
    expect(card).toMatch(/<a href=\{url\} target="_blank" rel="noopener noreferrer" data-post-link/)
  })
})
