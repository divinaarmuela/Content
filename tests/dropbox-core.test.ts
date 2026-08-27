import { describe, it, expect } from 'vitest'
import {
  MAX_SEGMENT, brandPath, clientPath, folderNameFor, itemPath, joinPath,
  monthPrefix, normaliseRoot, safeSegment, shootPaths, taskPath, typeWord,
  uniqueName,
} from '../app/lib/dropbox-core'

describe('safeSegment', () => {
  it('strips every character Dropbox refuses', () => {
    expect(safeSegment('a\\b/c:d?e*f"g<h>i|j')).toBe('abcdefghij')
  })

  it('keeps the characters a real title needs', () => {
    expect(safeSegment("Nathan's 30% off — Reel #2 (v1) & co."))
      .toBe("Nathan's 30% off — Reel #2 (v1) & co")
  })

  it('collapses whitespace and trims', () => {
    expect(safeSegment('  Spring   \n Campaign  ')).toBe('Spring Campaign')
  })

  it('drops control characters, which are invisible in a folder name', () => {
    const nul = String.fromCharCode(0)
    const bell = String.fromCharCode(7)
    const del = String.fromCharCode(127)
    expect(safeSegment('Sp' + nul + 'r' + bell + 'in' + del + 'g')).toBe('Spring')
  })

  it('caps a long name at 100 characters', () => {
    const out = safeSegment('x'.repeat(300))
    expect(out.length).toBe(MAX_SEGMENT)
  })

  it('never ends on a dot or a space — Windows clients cannot sync those', () => {
    expect(safeSegment('Final cut...')).toBe('Final cut')
    expect(safeSegment(`${'y'.repeat(99)}. tail`)).toBe('y'.repeat(99))
  })

  it('falls back rather than returning an empty component', () => {
    expect(safeSegment('///')).toBe('Untitled')
    expect(safeSegment('   ')).toBe('Untitled')
    expect(safeSegment('')).toBe('Untitled')
  })
})

describe('monthPrefix', () => {
  it('reads a plain date and a timestamp alike', () => {
    expect(monthPrefix('2026-08-14')).toBe('2026-08')
    expect(monthPrefix('2026-11-02T03:04:05.000Z')).toBe('2026-11')
  })

  it('is null for nothing and for nonsense', () => {
    expect(monthPrefix(null)).toBeNull()
    expect(monthPrefix(undefined)).toBeNull()
    expect(monthPrefix('')).toBeNull()
    expect(monthPrefix('not a date')).toBeNull()
  })
})

describe('typeWord', () => {
  it('maps every content type the board uses', () => {
    expect(typeWord('reel')).toBe('Reel')
    expect(typeWord('carousel')).toBe('Carousel')
    expect(typeWord('static')).toBe('Graphic')
    expect(typeWord('story')).toBe('Story')
    expect(typeWord('video')).toBe('Video')
    expect(typeWord('other')).toBe('Item')
  })

  it('an unknown or missing type is an Item, never a crash', () => {
    expect(typeWord('podcast')).toBe('Item')
    expect(typeWord(null)).toBe('Item')
    expect(typeWord(undefined)).toBe('Item')
  })
})

describe('folderNameFor.shoot', () => {
  it('leads with the shoot month so the client folder sorts chronologically', () => {
    expect(folderNameFor.shoot('Nathan Fielder', 'Spring Campaign', '2026-08-14'))
      .toBe('2026-08 Spring Campaign')
  })

  it('falls back to the month the brief was raised when no date is locked', () => {
    expect(folderNameFor.shoot('Nathan Fielder', 'Spring Campaign', null, '2026-07-02T09:00:00Z'))
      .toBe('2026-07 Spring Campaign')
  })

  it('prefers the shoot date over the created date', () => {
    expect(folderNameFor.shoot('C', 'Shoot', '2026-08-14', '2026-01-01'))
      .toBe('2026-08 Shoot')
  })

  it('is undated rather than wrongly dated when neither is known', () => {
    expect(folderNameFor.shoot('C', 'Spring Campaign', null)).toBe('Spring Campaign')
  })

  it('does not repeat the client — the folder already sits inside it', () => {
    expect(folderNameFor.shoot('Nathan Fielder', 'Spring', '2026-08-01'))
      .not.toContain('Nathan')
  })

  it('sanitises the title', () => {
    expect(folderNameFor.shoot('C', 'Q3/Q4 push', '2026-09-01')).toBe('2026-09 Q3Q4 push')
  })
})

describe('folderNameFor.item', () => {
  it('is type, padded number, then title', () => {
    expect(folderNameFor.item('reel', 1, 'Hook test')).toBe('Reel 01 - Hook test')
    expect(folderNameFor.item('static', 12, 'Price list')).toBe('Graphic 12 - Price list')
  })

  it('an unknown type still produces a usable folder', () => {
    expect(folderNameFor.item('podcast', 3, 'Ep 4')).toBe('Item 03 - Ep 4')
  })

  it('a bad index never yields "NaN" or "00"', () => {
    expect(folderNameFor.item('reel', 0, 'A')).toBe('Reel 01 - A')
    expect(folderNameFor.item('reel', -5, 'A')).toBe('Reel 01 - A')
    expect(folderNameFor.item('reel', Number.NaN, 'A')).toBe('Reel 01 - A')
  })

  it('strips forbidden characters out of the title', () => {
    expect(folderNameFor.item('video', 2, 'Before/After')).toBe('Video 02 - BeforeAfter')
  })
})

describe('folderNameFor.task', () => {
  it('is the title, made safe', () => {
    expect(folderNameFor.task('Rebrand research')).toBe('Rebrand research')
    expect(folderNameFor.task('Audit: socials?')).toBe('Audit socials')
  })
})

describe('path building', () => {
  it('normalises whatever shape the root is stored in', () => {
    expect(normaliseRoot('/Clients')).toBe('/Clients')
    expect(normaliseRoot('Clients')).toBe('/Clients')
    expect(normaliseRoot('/Clients/')).toBe('/Clients')
    expect(normaliseRoot('')).toBe('/Clients')
    expect(normaliseRoot(null)).toBe('/Clients')
    expect(normaliseRoot('/MD Media/Clients/')).toBe('/MD Media/Clients')
  })

  it('joins without ever producing a double slash', () => {
    expect(joinPath('/a/', '/b/', 'c')).toBe('/a/b/c')
    expect(joinPath('a', null, undefined, '', 'b')).toBe('/a/b')
  })

  it('builds the whole shoot set', () => {
    const p = shootPaths('/Clients', 'Nathan Fielder', '2026-08 Spring Campaign')
    expect(p.shoot).toBe('/Clients/Nathan Fielder/2026-08 Spring Campaign')
    expect(p.raw).toBe('/Clients/Nathan Fielder/2026-08 Spring Campaign/01 Raw')
    expect(p.edits).toBe('/Clients/Nathan Fielder/2026-08 Spring Campaign/02 Edits')
    expect(p.final).toBe('/Clients/Nathan Fielder/2026-08 Spring Campaign/03 Final')
  })

  it('numbers the shoot subfolders so they sort in working order', () => {
    const p = shootPaths('/Clients', 'C', 'S')
    const names = [p.raw, p.edits, p.final].map(x => x.split('/').pop()!)
    expect([...names].sort()).toEqual(names)
  })

  it('puts a deliverable under 02 Edits', () => {
    expect(itemPath('/Clients', 'Acme', '2026-08 Shoot', 'Reel 01 - Hook'))
      .toBe('/Clients/Acme/2026-08 Shoot/02 Edits/Reel 01 - Hook')
  })

  it('puts internal work under _Tasks and reference under _Brand', () => {
    expect(taskPath('/Clients', 'Acme', 'Rebrand research'))
      .toBe('/Clients/Acme/_Tasks/Rebrand research')
    expect(brandPath('/Clients', 'Acme')).toBe('/Clients/Acme/_Brand')
    expect(clientPath('/Clients', 'Acme')).toBe('/Clients/Acme')
  })

  it('sanitises a client name that would otherwise open a new folder level', () => {
    expect(clientPath('/Clients', 'Acme / Beta')).toBe('/Clients/Acme Beta')
  })
})

describe('uniqueName — collisions', () => {
  it('leaves a free name alone', () => {
    expect(uniqueName('Content Day', [])).toBe('Content Day')
    expect(uniqueName('Content Day', ['Other'])).toBe('Content Day')
  })

  it('the same title twice gets " (2)"', () => {
    expect(uniqueName('Content Day', ['Content Day'])).toBe('Content Day (2)')
  })

  it('counts up past an existing suffix', () => {
    expect(uniqueName('Content Day', ['Content Day', 'Content Day (2)']))
      .toBe('Content Day (3)')
  })

  it('is case-insensitive, because Dropbox paths are', () => {
    expect(uniqueName('Content Day', ['CONTENT DAY'])).toBe('Content Day (2)')
  })

  it('compares on the SAFE name, not the raw one', () => {
    // "Content: Day" and "Content Day" become the same folder — the collision
    // is real even though the titles differ
    expect(uniqueName('Content: Day', ['Content Day'])).toBe('Content Day (2)')
  })

  it('keeps the suffix inside the length cap', () => {
    const long = 'z'.repeat(100)
    const out = uniqueName(long, [long])
    expect(out.length).toBeLessThanOrEqual(MAX_SEGMENT)
    expect(out.endsWith(' (2)')).toBe(true)
  })

  it('a whole shoot folder can collide and still resolve', () => {
    const name = folderNameFor.shoot('Acme', 'Content Day', '2026-08-14')
    expect(uniqueName(name, [name])).toBe('2026-08 Content Day (2)')
  })

  it('two identical items in one shoot get distinct folders', () => {
    const a = folderNameFor.item('reel', 1, 'Hook')
    const b = folderNameFor.item('reel', 1, 'Hook')
    const taken: string[] = []
    const first = uniqueName(a, taken); taken.push(first)
    const second = uniqueName(b, taken); taken.push(second)
    expect(first).toBe('Reel 01 - Hook')
    expect(second).toBe('Reel 01 - Hook (2)')
  })
})
