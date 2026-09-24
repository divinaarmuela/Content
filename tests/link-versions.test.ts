import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LINK_VERSIONS_MAX, earlierLinkVersions, linkForVersion, linkVersionsOf, withLinkVersion,
} from '../app/lib/card-link-core'

/**
 * EVERY CUT STAYS OPENABLE (the owner, 24 Sep 2026: "where is the version 1
 * and version 2").
 *
 * Seen live on Jordan Wilson's First Shoot: eight finished-edit links saved
 * between 21 and 24 September, one `link_url` field, so only the eighth was
 * still reachable — and the cut the client had written sixteen comments about
 * was gone from the card.
 */
describe('a card keeps the link of every version', () => {
  const at = (d: string) => `2026-09-${d}T00:00:00.000Z`

  it('keeps one entry per version, oldest first', () => {
    let card: { link_versions?: unknown } = {}
    card = { link_versions: withLinkVersion(card, { version: 1, url: 'https://drive.google.com/a', kind: 'drive', by: 'u1', at: at('21') }) }
    card = { link_versions: withLinkVersion(card, { version: 2, url: 'https://drive.google.com/b', kind: 'drive', by: 'u1', at: at('24') }) }
    expect(linkVersionsOf(card).map(v => [v.version, v.url])).toEqual([
      [1, 'https://drive.google.com/a'],
      [2, 'https://drive.google.com/b'],
    ])
    expect(linkForVersion(card, 1)?.url).toBe('https://drive.google.com/a')
    expect(linkForVersion(card, 9)).toBeNull()
  })

  it('a correction to the same version replaces its entry rather than stacking', () => {
    let card: { link_versions?: unknown } = {}
    card = { link_versions: withLinkVersion(card, { version: 1, url: 'https://drive.google.com/typo', kind: 'drive', at: at('21') }) }
    card = { link_versions: withLinkVersion(card, { version: 1, url: 'https://drive.google.com/right', kind: 'drive', at: at('21') }) }
    expect(linkVersionsOf(card)).toHaveLength(1)
    expect(linkForVersion(card, 1)?.url).toBe('https://drive.google.com/right')
  })

  it('ignores a row with no url or no version, and is bounded', () => {
    expect(linkVersionsOf({ link_versions: [{ version: 0, url: 'x' }, { version: 2 }, null, 'nonsense'] })).toEqual([])
    expect(linkVersionsOf({})).toEqual([])
    let card: { link_versions?: unknown } = {}
    for (let n = 1; n <= LINK_VERSIONS_MAX + 5; n++) {
      card = { link_versions: withLinkVersion(card, { version: n, url: `https://drive.google.com/${n}`, kind: 'drive', at: at('21') }) }
    }
    expect(linkVersionsOf(card)).toHaveLength(LINK_VERSIONS_MAX)
    expect(linkVersionsOf(card)[0].version).toBe(6)
  })

  it('the earlier ones are the ones worth listing beside the current link', () => {
    const card = {
      current_version_number: 3,
      link_versions: [
        { version: 1, url: 'https://drive.google.com/a', kind: 'drive', at: at('21') },
        { version: 2, url: 'https://drive.google.com/b', kind: 'drive', at: at('22') },
        { version: 3, url: 'https://drive.google.com/c', kind: 'drive', at: at('24') },
      ],
    }
    expect(earlierLinkVersions(card).map(v => v.version)).toEqual([1, 2])
  })

  it('the save records it, and a Drive card gets the per-file flow like any other', () => {
    const route = readFileSync('app/api/production/items/[id]/link/route.ts', 'utf8')
    expect(route).toContain('withLinkVersion(cur as never, { version: next.version, url: check.url, kind: check.kind, by: user.id')
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    // the copied clips used to become the card's files only once it had been sent back AND the client had seen
    // it, so a card handed in by link and never past round 1 had no files and no per-file replace at all
    expect(drawer).toContain('if (!needsAdoption(item as never)) return')
    expect(drawer).not.toContain('handInRound(item as never) === roundOf(item as never)) return')
    expect(drawer).toContain('Handed in before')
    expect(readFileSync('docs/schema-history/link_versions.sql', 'utf8'))
      .toContain('alter table content_items add column if not exists link_versions jsonb;')
  })
})
