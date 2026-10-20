import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { MILANOTE_ICONS, isGlyphIcon, isOwnIconUrl, localIconUrl, milanoteIconUrl, searchIcons } from '../app/lib/board-icons-core'
import { sanitiseCanvasCards } from '../app/lib/batch-brief-core'

// the owner, 20 Oct 2026: "i notice these icons are not available in our software?"
describe('Milanote’s board icons, kept by us', () => {
  it('lists exactly the files in public/board-icons/milanote', () => {
    const files = readdirSync('public/board-icons/milanote').map(f => f.replace(/\.png$/, '')).sort()
    expect([...MILANOTE_ICONS].sort()).toEqual(files)
    expect(MILANOTE_ICONS.length).toBe(117)
    for (const n of MILANOTE_ICONS) expect(existsSync(`public${milanoteIconUrl(n)}`)).toBe(true)
  })
  it('moves a Milanote address onto our copy, and leaves anything else', () => {
    expect(localIconUrl('https://static.milanote.com/element-icons/png/48x48/star-shooting.png')).toBe('/board-icons/milanote/star-shooting.png')
    expect(localIconUrl('https://static.milanote.com/element-icons/png/48x48/not-one-we-have.png')).toBe('https://static.milanote.com/element-icons/png/48x48/not-one-we-have.png')
    expect(localIconUrl('https://cdn.example.com/logo.jpg')).toBe('https://cdn.example.com/logo.jpg')
  })
  it('only our own icons pass as a local address', () => {
    expect(isOwnIconUrl('/board-icons/milanote/star-shooting.png')).toBe(true)
    expect(isOwnIconUrl('/board-icons/milanote/../../secret.png')).toBe(false)
    expect(isOwnIconUrl('/board-icons/milanote/nope.png')).toBe(false)
    expect(isGlyphIcon('/board-icons/milanote/star-shooting.png')).toBe(true)
    expect(isGlyphIcon('https://cdn.example.com/logo.jpg')).toBe(false)
  })
  it('finds an icon by the words in its name', () => {
    expect(searchIcons('star')).toContain('star-shooting')
    expect(searchIcons('file invoice')).toEqual(['file-invoice'])
    expect(searchIcons('').length).toBe(117)
  })
})

describe('a saved board tile keeps its icon', () => {
  const tile = (icon_url: string) => sanitiseCanvasCards([{ id: 'b1', kind: 'board', name: 'Shoot', x: 0, y: 0, z: 1, w: 88, icon_url }])[0]
  it('ours and a web picture are kept; anything else is dropped', () => {
    expect(tile('/board-icons/milanote/star-shooting.png')?.icon_url).toBe('/board-icons/milanote/star-shooting.png')
    expect(tile('https://static.milanote.com/element-icons/png/48x48/1.png')?.icon_url).toBe('https://static.milanote.com/element-icons/png/48x48/1.png')
    expect(tile('/etc/passwd')?.icon_url).toBeUndefined()
  })
})
