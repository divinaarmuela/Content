import { describe, it, expect } from 'vitest'
import { contrast, googleFontsHref, luminance, pickPortalTheme, tint } from '../app/lib/portal-theme'

describe('luminance & contrast — the guards the theme leans on', () => {
  it('orders black, mid, white correctly', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBe(1)
    expect(contrast('#000000', '#ffffff')).toBe(21)
  })
  it('rubbish hex is harmless', () => {
    expect(luminance('teal')).toBeNull()
    expect(contrast('nope', '#ffffff')).toBe(1)
  })
})

describe('pickPortalTheme — a client portal wears the client brand, readably', () => {
  const releeph = {
    colors: [
      { name: 'Soft Ivory', hex: '#F7F3ED', usage: 'background' },
      { name: 'Latte', hex: '#8B7466', usage: 'primary' },
      { name: 'Soft Blue', hex: '#CCEBF1' },
      { name: 'Almost Black', hex: '#020202', usage: 'text' },
    ],
    fonts: [{ family: 'Cormorant Garamond', usage: 'headings' }, { family: 'Inter', usage: 'body' }],
  }

  it('takes the stated background and a readable accent', () => {
    const t = pickPortalTheme(releeph)
    expect(t.branded).toBe(true)
    expect(t.bg).toBe('#F7F3ED')
    expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(2.2)
    expect(t.headingFont).toContain('Cormorant Garamond')
    expect(t.bodyFont).toContain('Inter')
    expect(t.fontFamilies).toEqual(['Cormorant Garamond', 'Inter'])
  })

  it('text on the accent always reads: whichever of white/black clears contrast', () => {
    const dark = pickPortalTheme({ colors: [{ hex: '#1a1a2e', usage: 'primary' }] })
    expect(dark.accentInk).toBe('#ffffff')
    // whatever the palette, the chosen pair must actually be readable
    for (const hex of ['#8B7466', '#E91E63', '#2E9E44', '#00A896']) {
      const t = pickPortalTheme({ colors: [{ hex, usage: 'primary' }] })
      expect(contrast(t.accentInk, t.accent)).toBeGreaterThanOrEqual(2.2)
    }
  })

  it('an accent too pale to read on the background is refused entirely', () => {
    const t = pickPortalTheme({ colors: [{ hex: '#F5E642', usage: 'primary' }, { hex: '#ffffff', usage: 'background' }] })
    expect(t.accent).toBe('#18181b') // safe default, not the unreadable yellow
  })

  it('a dark-only palette refuses to become an unreadable page', () => {
    const t = pickPortalTheme({ colors: [{ hex: '#0a0a0a' }, { hex: '#222222' }] })
    expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('no brand data → clean neutral defaults', () => {
    const t = pickPortalTheme(null)
    expect(t.branded).toBe(false)
    expect(t.bg).toBe('#fafafa')
    expect(t.fontFamilies).toEqual([])
  })

  it('one font serves both heading and body', () => {
    const t = pickPortalTheme({ fonts: [{ family: 'Poppins' }] })
    expect(t.headingFont).toContain('Poppins')
    expect(t.bodyFont).toContain('Poppins')
    expect(t.fontFamilies).toEqual(['Poppins'])
  })
})

describe('googleFontsHref', () => {
  it('builds a two-family request', () => {
    const href = googleFontsHref(['Cormorant Garamond', 'Inter'])
    expect(href).toContain('family=Cormorant+Garamond')
    expect(href).toContain('family=Inter')
  })
  it('is null with nothing to load', () => {
    expect(googleFontsHref([])).toBeNull()
  })
})

describe('tint', () => {
  it('moves a colour toward white', () => {
    expect(tint('#000000', 1)).toBe('#ffffff')
    expect(tint('#000000', 0)).toBe('#000000')
  })
})
