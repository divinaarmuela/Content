import { describe, it, expect } from 'vitest'
import {
  applyProposal, asHandle, asHashtag, emptyProfile, foldScanIntoProfile, fromScan,
  guessColourRole, moveItem, normaliseHex, normaliseProfile, profileHasContent,
  proposeFromScan, scanIsUnreviewed, toScanShape, validateProfile, MAX_ITEMS,
} from '../app/lib/brand-profile-core'
import { pickPortalTheme } from '../app/lib/portal-theme'

describe('normaliseHex', () => {
  it('accepts the shapes people type', () => {
    expect(normaliseHex('#1a2b3c')).toBe('#1A2B3C')
    expect(normaliseHex('1A2B3C')).toBe('#1A2B3C')
    expect(normaliseHex(' #abc ')).toBe('#AABBCC')
  })
  it('refuses everything else', () => {
    for (const v of ['#12345', 'red', '', null, 42, '#GGGGGG']) expect(normaliseHex(v)).toBeNull()
  })
})

describe('normaliseProfile', () => {
  it('drops bad hexes, dedupes colours by hex and fonts by name, keeps order', () => {
    const p = normaliseProfile({
      colours: [
        { name: 'Blue', hex: '#0057ff', role: 'primary' },
        { name: 'Again', hex: '0057FF' },
        { name: 'Nope', hex: 'blue' },
        { name: 'Ink', hex: '#111', role: 'text' },
      ],
      fonts: [{ name: 'Lora', role: 'heading' }, { name: 'lora' }, { name: '' }, { name: 'Inter', role: 'silly', url: 'not a url' }],
    })
    expect(p.colours).toEqual([
      { name: 'Blue', hex: '#0057FF', role: 'primary' },
      { name: 'Ink', hex: '#111111', role: 'text' },
    ])
    expect(p.fonts).toEqual([{ name: 'Lora', role: 'heading' }, { name: 'Inter', role: 'body' }])
  })

  it('normalises hashtags and handles and dedupes text lists case-insensitively', () => {
    const p = normaliseProfile({
      hashtags: ['summer', '#Summer', '## sale '], handles: ['@shop', 'shop', 'other'],
      logo_rules: ['Keep clear space', 'keep clear space', ''],
    })
    expect(p.hashtags).toEqual(['#summer', '#sale'])
    expect(p.handles).toEqual(['@shop', '@other'])
    expect(p.logo_rules).toEqual(['Keep clear space'])
  })

  it('caps lists and survives rubbish', () => {
    expect(normaliseProfile(null)).toEqual(emptyProfile())
    const p = normaliseProfile({ logo_rules: Array.from({ length: 500 }, (_, i) => `rule ${i}`) })
    expect(p.logo_rules).toHaveLength(MAX_ITEMS)
  })
})

describe('validateProfile — says what is wrong', () => {
  it('names the colour with the bad code', () => {
    const r = validateProfile({ colours: [{ name: 'Sky', hex: 'skyblue' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Sky')
  })
  it('refuses non-objects and non-lists', () => {
    expect(validateProfile([]).ok).toBe(false)
    expect(validateProfile({ fonts: 'Lora' }).ok).toBe(false)
    expect(validateProfile({ fonts: [{ name: '' }] }).ok).toBe(false)
    expect(validateProfile({ logo_files: [{ name: 'logo', url: 'logo.png' }] }).ok).toBe(false)
  })
  it('returns the normalised profile when fine', () => {
    const r = validateProfile({ colours: [{ name: 'Sky', hex: '#abc' }], rev: 3 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.profile.colours[0].hex).toBe('#AABBCC')
      expect(r.profile.rev).toBe(3)
    }
  })
})

describe('fromScan — the scan seeds the profile', () => {
  const scan = {
    summary: 'Warm and direct.',
    colors: [
      { name: 'Ivory', hex: '#F7F3EA', usage: 'backgrounds' },
      { name: 'Forest', hex: '#14392B', usage: 'primary brand colour' },
      { name: 'No hex', usage: 'accent' },
      { name: 'Charcoal', hex: '#222222', usage: 'body text' },
    ],
    fonts: [{ family: 'Lora', usage: 'headlines' }, { family: 'Inter', usage: 'body' }],
    logo_rules: ['Never stretch the logo'],
    voice: { tone: 'Confident', description: 'Plain words, no jargon.', keywords: ['clear'] },
    imagery: ['Natural light'],
    dos_and_donts: { dos: ['Use white space'], donts: ['No filters'] },
    other_rules: ['Sentence case'],
  }

  it('maps roles and orders colours main → text', () => {
    const p = fromScan(scan, '2026-08-27T00:00:00Z')
    expect(p.colours.map(c => [c.hex, c.role])).toEqual([
      ['#14392B', 'primary'], ['#F7F3EA', 'background'], ['#222222', 'text'],
    ])
    expect(p.fonts).toEqual([{ name: 'Lora', role: 'heading' }, { name: 'Inter', role: 'body' }])
    expect(p.voice).toEqual({ summary: 'Plain words, no jargon.', tone: 'Confident', dos: ['Use white space'], donts: ['No filters'] })
    expect(p.logo_rules).toEqual(['Never stretch the logo'])
    expect(p.notes).toContain('• Natural light')
    expect(p.notes).toContain('• Sentence case')
    expect(p.reviewed_scan_at).toBe('2026-08-27T00:00:00Z')
  })

  it('guesses roles from wording', () => {
    expect(guessColourRole('Cream', undefined)).toBe('background')
    expect(guessColourRole('Pop', 'accent for buttons')).toBe('accent')
    expect(guessColourRole('X', undefined, 0)).toBe('primary')
    expect(guessColourRole('X', undefined, 3)).toBe('secondary')
  })

  it('round-trips into the shape the portal theme and brand card read', () => {
    const shape = toScanShape(fromScan(scan))
    expect(shape.colors?.[0]).toEqual({ name: 'Forest', hex: '#14392B', usage: 'primary' })
    expect(shape.fonts?.[0]).toEqual({ family: 'Lora', usage: 'heading' })
    expect(shape.voice).toEqual({ tone: 'Confident', description: 'Plain words, no jargon.' })
    expect(shape.dos_and_donts).toEqual({ dos: ['Use white space'], donts: ['No filters'] })
    const theme = pickPortalTheme(shape)
    expect(theme.accent).toBe('#14392B')
    expect(theme.bg).toBe('#F7F3EA')
    expect(theme.headingFont).toContain('Lora')
  })

  it('an empty scan is an empty profile', () => {
    expect(profileHasContent(fromScan(null))).toBe(false)
    expect(profileHasContent(fromScan(scan))).toBe(true)
  })
})

describe('re-scan proposes, never overwrites', () => {
  const current = normaliseProfile({
    rev: 4,
    colours: [{ name: 'Forest (hand-picked)', hex: '#14392B', role: 'primary' }],
    fonts: [{ name: 'Lora', role: 'heading' }],
    logo_rules: ['Never stretch the logo'],
    voice: { summary: 'My own words.', tone: '', dos: [], donts: ['No filters'] },
    reviewed_scan_at: '2026-08-01T00:00:00Z',
  })
  const scan = {
    colors: [{ name: 'Forest', hex: '#14392b', usage: 'primary' }, { name: 'Gold', hex: '#C9A227', usage: 'accent' }],
    fonts: [{ family: 'lora' }, { family: 'Inter', usage: 'body' }],
    logo_rules: ['never stretch the logo', 'Keep clear space'],
    voice: { tone: 'Confident', description: 'Scanner prose' },
    dos_and_donts: { dos: ['Use white space'], donts: ['No filters'] },
  }

  it('lists only what is new; existing entries keep their hand edits', () => {
    const prop = proposeFromScan(current, scan, '2026-08-27T00:00:00Z')
    expect(prop.changes.map(c => c.id)).toEqual([
      'colour:#C9A227', 'font:inter', 'logo_rules:keep clear space', 'dos:use white space', 'voice_tone',
    ])
    // the summary is already written by hand, so the scanner's is not offered
    expect(prop.changes.find(c => c.section === 'voice_summary')).toBeUndefined()
  })

  it('accept all folds everything in and marks the scan reviewed', () => {
    const prop = proposeFromScan(current, scan, '2026-08-27T00:00:00Z')
    const next = applyProposal(current, prop, prop.changes.map(c => c.id))
    expect(next.colours.map(c => c.name)).toEqual(['Forest (hand-picked)', 'Gold'])
    expect(next.fonts.map(f => f.name)).toEqual(['Lora', 'Inter'])
    expect(next.logo_rules).toEqual(['Never stretch the logo', 'Keep clear space'])
    expect(next.voice.tone).toBe('Confident')
    expect(next.voice.summary).toBe('My own words.')
    expect(next.reviewed_scan_at).toBe('2026-08-27T00:00:00Z')
    expect(scanIsUnreviewed(next, '2026-08-27T00:00:00Z')).toBe(false)
  })

  it('picking some leaves the rest out, and they are not asked again', () => {
    const prop = proposeFromScan(current, scan, '2026-08-27T00:00:00Z')
    const next = applyProposal(current, prop, ['font:inter'])
    expect(next.fonts).toHaveLength(2)
    expect(next.colours).toHaveLength(1)
    expect(scanIsUnreviewed(next, '2026-08-27T00:00:00Z')).toBe(false)
  })

  it('knows when a scan is newer than the last review', () => {
    expect(scanIsUnreviewed(current, '2026-08-27T00:00:00Z')).toBe(true)
    expect(scanIsUnreviewed(current, '2026-07-01T00:00:00Z')).toBe(false)
    expect(scanIsUnreviewed(current, null)).toBe(false)
    expect(scanIsUnreviewed(emptyProfile(), '2026-07-01T00:00:00Z')).toBe(true)
  })
})

describe('small helpers', () => {
  it('moveItem reorders and ignores nonsense', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
    expect(moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3])
  })
  it('hashtags and handles get their sigil once', () => {
    expect(asHashtag('##Sale now')).toBe('#Salenow')
    expect(asHandle('@@md')).toBe('@md')
    expect(asHashtag('  ')).toBe('')
  })
})

describe('foldScanIntoProfile — a brand-guide scan lands colours/fonts, fill-if-empty', () => {
  // the Turnkey_Brand_Manual palette + fonts, as a correct scan would return them
  const turnkeyScan = {
    summary: 'Considered, premium, local builder.',
    colors: [
      { name: 'Gold', hex: '#957B60', usage: 'primary' },
      { name: 'Black', hex: '#000000', usage: 'text' },
      { name: 'White', hex: '#FFFFFF', usage: 'background' },
    ],
    fonts: [
      { family: 'GTF Solina Medium', usage: 'headlines' },
      { family: 'GTF Solina Regular', usage: 'body copy' },
      { family: 'Helvetica Bold Condensed', usage: 'labels' },
    ],
  }

  it('folds the labelled palette + fonts into an empty profile', () => {
    const { profile, changed } = foldScanIntoProfile(emptyProfile(), turnkeyScan)
    expect(changed).toBe(true)
    const hexes = profile.colours.map(c => c.hex)
    expect(hexes).toContain('#957B60')
    expect(hexes).toContain('#000000')
    expect(hexes).toContain('#FFFFFF')
    const fonts = profile.fonts.map(f => f.name)
    expect(fonts.some(n => /GTF Solina/i.test(n))).toBe(true)
    expect(fonts.some(n => /Helvetica/i.test(n))).toBe(true)
    // a heading and a body role are assigned
    expect(profile.fonts.some(f => f.role === 'heading')).toBe(true)
    expect(profile.fonts.some(f => f.role === 'body')).toBe(true)
  })

  it('never overwrites colours/fonts that already exist', () => {
    const current = normaliseProfile({
      ...emptyProfile(),
      colours: [{ name: 'Brand blue', hex: '#112233', role: 'primary' }],
      fonts: [{ name: 'Existing Sans', role: 'heading' }],
      // already-filled voice, so the only thing the scan could add is colours/fonts
      voice: { summary: 'Hand-written summary.', tone: 'Set', dos: ['x'], donts: ['y'] },
    })
    const { profile, changed } = foldScanIntoProfile(current, turnkeyScan)
    expect(changed).toBe(false)
    expect(profile.colours.map(c => c.hex)).toEqual(['#112233'])
    expect(profile.fonts.map(f => f.name)).toEqual(['Existing Sans'])
  })

  it('does nothing for an empty scan', () => {
    expect(foldScanIntoProfile(emptyProfile(), null).changed).toBe(false)
    expect(foldScanIntoProfile(emptyProfile(), {}).changed).toBe(false)
  })
})
