import { describe, it, expect } from 'vitest'
import {
  EDITS_FOLDER, FOLDER_MIME, MAX_SEGMENT, brandChain, chain, clientChain,
  escapeQueryValue, folderNameFor, folderQuery, folderUrl, itemChain,
  monthPrefix, noShootChain, normaliseRoot, safeSegment, shootChains,
  taskChain, typeWord, uniqueName,
} from '../app/lib/gdrive-core'

describe('safeSegment', () => {
  it('strips the slash, which reads as a folder level that is not there', () => {
    expect(safeSegment('Q3/Q4 push')).toBe('Q3Q4 push')
  })

  it('keeps everything Drive is perfectly happy with', () => {
    // Drive does not mind : ? * " < > or |, and a title that reads correctly
    // is worth more than a sanitised one
    expect(safeSegment('Audit: socials? "v2" <final> | 100% *hero*'))
      .toBe('Audit: socials? "v2" <final> | 100% *hero*')
    expect(safeSegment("Nathan's 30% off — Reel #2 (v1) & co"))
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
    expect(safeSegment('x'.repeat(300)).length).toBe(MAX_SEGMENT)
  })

  it('never ends on a dot or a space — desktop sync cannot handle those', () => {
    expect(safeSegment('Final cut...')).toBe('Final cut')
    expect(safeSegment(`${'y'.repeat(99)}. tail`)).toBe('y'.repeat(99))
  })

  it('falls back rather than returning an empty name', () => {
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
    expect(folderNameFor.shoot('C', 'Shoot', '2026-08-14', '2026-01-01')).toBe('2026-08 Shoot')
  })

  it('is undated rather than wrongly dated when neither is known', () => {
    expect(folderNameFor.shoot('C', 'Spring Campaign', null)).toBe('Spring Campaign')
  })

  it('does not repeat the client — the folder already sits inside it', () => {
    expect(folderNameFor.shoot('Nathan Fielder', 'Spring', '2026-08-01')).not.toContain('Nathan')
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

  it('strips a slash out of the title', () => {
    expect(folderNameFor.item('video', 2, 'Before/After')).toBe('Video 02 - BeforeAfter')
  })
})

describe('folderNameFor.task', () => {
  it('is the title, made safe', () => {
    expect(folderNameFor.task('Rebrand research')).toBe('Rebrand research')
    expect(folderNameFor.task('Audit socials')).toBe('Audit socials')
  })
})

describe('the root folder name', () => {
  it('is a plain name — Drive has no paths, so a leading slash is not one', () => {
    expect(normaliseRoot('Clients')).toBe('Clients')
    expect(normaliseRoot('/Clients')).toBe('Clients')
    expect(normaliseRoot('/Clients/')).toBe('Clients')
    expect(normaliseRoot('')).toBe('Clients')
    expect(normaliseRoot(null)).toBe('Clients')
    expect(normaliseRoot('MD Media Clients')).toBe('MD Media Clients')
  })
})

describe('chains', () => {
  it('drops empties and never produces a blank level', () => {
    expect(chain('a', null, undefined, '', 'b')).toEqual(['a', 'b'])
    expect(chain('/a/', '/b/', 'c')).toEqual(['a', 'b', 'c'])
  })

  it('builds the whole shoot set, parents before children', () => {
    const c = shootChains('Nathan Fielder', '2026-08 Spring Campaign')
    expect(c.shoot).toEqual(['Nathan Fielder', '2026-08 Spring Campaign'])
    expect(c.raw).toEqual(['Nathan Fielder', '2026-08 Spring Campaign', '01 Raw'])
    expect(c.edits).toEqual(['Nathan Fielder', '2026-08 Spring Campaign', '02 Edits'])
    expect(c.final).toEqual(['Nathan Fielder', '2026-08 Spring Campaign', '03 Final'])
  })

  it('numbers the shoot subfolders so they sort in working order', () => {
    const c = shootChains('C', 'S')
    const names = [c.raw, c.edits, c.final].map(x => x[x.length - 1])
    expect([...names].sort()).toEqual(names)
    expect(EDITS_FOLDER).toBe('02 Edits')
  })

  it('puts a deliverable under 02 Edits', () => {
    expect(itemChain('Acme', '2026-08 Shoot', 'Reel 01 - Hook'))
      .toEqual(['Acme', '2026-08 Shoot', '02 Edits', 'Reel 01 - Hook'])
  })

  it('files internal work under _Tasks and reference under _Brand', () => {
    expect(taskChain('Acme', 'Rebrand research')).toEqual(['Acme', '_Tasks', 'Rebrand research'])
    expect(brandChain('Acme')).toEqual(['Acme', '_Brand'])
    expect(clientChain('Acme')).toEqual(['Acme'])
  })

  it('files a real deliverable with no shoot under _No shoot, not _Tasks', () => {
    // client-sent footage is a deliverable, not a research job — it belongs
    // beside the shoots, where an editor looking for footage would go
    expect(noShootChain('Acme', 'Reel 01 - Phone footage'))
      .toEqual(['Acme', '_No shoot', 'Reel 01 - Phone footage'])
  })

  it('the three fixed folders group together, away from the dated shoots', () => {
    // `_` sorts AFTER digits, so these land in one block at the END of the
    // client folder — NOT above the shoots, however much the underscore
    // prefix suggests otherwise. The property that matters is that they are
    // contiguous and the shoots stay chronological.
    const names = ['2026-07 A', '2026-08 B', '_Brand', '_No shoot', '_Tasks']
    expect([...names].sort()).toEqual(names)
  })

  it('sanitises a client name that would otherwise open a new folder level', () => {
    expect(clientChain('Acme / Beta')).toEqual(['Acme', 'Beta'])
    expect(taskChain('Acme / Beta', 'Job')).toEqual(['Acme', 'Beta', '_Tasks', 'Job'])
  })
})

describe('folderUrl', () => {
  it('is the one folder URL form Drive publishes', () => {
    expect(folderUrl('1AbC_dEf')).toBe('https://drive.google.com/drive/folders/1AbC_dEf')
  })
})

describe('search query escaping', () => {
  it('escapes an apostrophe, or the query silently means something else', () => {
    expect(escapeQueryValue("Nathan's")).toBe("Nathan\\'s")
  })

  it('escapes a backslash BEFORE the apostrophe, not after', () => {
    expect(escapeQueryValue('a\\b')).toBe('a\\\\b')
    expect(escapeQueryValue("a\\'b")).toBe("a\\\\\\'b")
  })

  it('leaves an ordinary name alone', () => {
    expect(escapeQueryValue('2026-08 Spring Campaign')).toBe('2026-08 Spring Campaign')
  })

  it('builds a query that scopes to one parent, one name, folders, not trashed', () => {
    const q = folderQuery('PARENT1', 'Spring')
    expect(q).toBe(
      "'PARENT1' in parents and name = 'Spring' and " +
      `mimeType = '${FOLDER_MIME}' and trashed = false`,
    )
  })

  it('escapes inside the query too', () => {
    expect(folderQuery('P', "Nathan's")).toContain("name = 'Nathan\\'s'")
  })

  it('always excludes trashed folders — a deleted folder must not be reused', () => {
    expect(folderQuery('P', 'X')).toContain('trashed = false')
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
    expect(uniqueName('Content Day', ['Content Day', 'Content Day (2)'])).toBe('Content Day (3)')
  })

  it('is case-insensitive, because people do not distinguish', () => {
    expect(uniqueName('Content Day', ['CONTENT DAY'])).toBe('Content Day (2)')
  })

  it('compares on the SAFE name, not the raw one', () => {
    expect(uniqueName('Content/Day', ['ContentDay'])).toBe('ContentDay (2)')
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
