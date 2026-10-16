import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AREAS_OF, OPTIONAL_AREAS, connectLinkPath, parseOff, scopesFor } from '../app/lib/connect-link-core'

/**
 * WHAT A CONNECTION LETS US DO, ON OR OFF, PER CONNECT LINK (the owner, 16 Oct 2026: "does our link include toggling on
 * and off for message inbox?" → "why don't you add all"). Zernio asks the network for every area unless `scopes` names
 * fewer (docs.zernio.com/guides/connecting-accounts). Posting is never optional. Decided at sign-in.
 */
const T = '8535c670-33ae-4940-b0ad-cc76a2c07bae'

describe('the link carries what is switched off', () => {
  it('nothing off adds nothing — every link made before still means "everything"', () => {
    expect(connectLinkPath(T, ['instagram', 'facebook', 'tiktok'])).toBe(`/connect/${T}?networks=instagram,facebook,tiktok`)
  })
  it('off areas travel in one fixed order, after the person', () => {
    expect(connectLinkPath(T, ['instagram'], 'abc', ['messaging', 'comments'])).toBe(`/connect/${T}?networks=instagram&for=abc&off=comments,messaging`)
  })
  it('reads them back, ignoring anything that is not an optional area (posting can never be switched off)', () => {
    expect(parseOff('messaging,posting,nonsense,ADS')).toEqual(['messaging', 'ads'])
    expect(parseOff(undefined)).toEqual([])
  })
  it('the first links of all (inbox=0, pushed earlier today) still mean messaging off', () => {
    expect(parseOff(undefined, '0')).toEqual(['messaging'])
    expect(parseOff('comments', 'off')).toEqual(['comments', 'messaging'])
    expect(parseOff(undefined, '1')).toEqual([])
  })
})

describe('what Zernio is asked for', () => {
  it('nothing off: no scopes sent, so Zernio asks for every area, exactly as before', () => {
    expect(scopesFor('instagram', [])).toBeNull()
    expect(scopesFor('facebook', [])).toBeNull()
  })
  it('Instagram without the inbox', () => {
    expect(scopesFor('instagram', ['messaging'])).toBe('posting,analytics,comments')
  })
  it('Instagram posting only', () => {
    expect(scopesFor('instagram', ['analytics', 'comments', 'messaging'])).toBe('posting')
  })
  it('Facebook without ads keeps its inbox', () => {
    expect(scopesFor('facebook', ['ads'])).toBe('posting,analytics,comments,messaging')
  })
  it('switching off something a network does not have changes nothing for it (ads on Instagram)', () => {
    expect(scopesFor('instagram', ['ads'])).toBeNull()
  })
  it('a network without documented areas is never sent scopes', () => {
    for (const p of ['tiktok', 'linkedin', 'youtube', 'threads', 'x', 'pinterest']) expect(scopesFor(p, [...OPTIONAL_AREAS])).toBeNull()
  })
  it('posting is always asked for', () => {
    for (const p of Object.keys(AREAS_OF)) expect(scopesFor(p, [...OPTIONAL_AREAS])?.split(',')[0]).toBe('posting')
  })
})

describe('wired through', () => {
  it('the publisher sends `scopes` to Zernio only when given one', () => {
    expect(readFileSync('app/lib/publisher.ts', 'utf8')).toContain("if (scopes) qs.set('scopes', scopes)")
  })
  it("the connect route reads the link's choice and asks for the matching scopes", () => {
    const s = readFileSync('app/api/connect/[token]/route.ts', 'utf8')
    expect(s).toContain('parseOff(body.off, body.inbox)')
    expect(s).toContain('scopes: scopesFor(body.platform, off)')
  })
  it("the client chooses on their connect page: ticks start from the link, what they leave ticked is what is asked for", () => {
    const s = readFileSync('app/connect/[token]/ConnectNetworks.tsx', 'utf8')
    expect(s).toContain('useState<OptionalArea[]>(() => OPTIONAL_AREAS.filter(a => off.includes(a)))')
    expect(s).toContain("off: choice.length ? choice.join(',') : undefined")
    expect(s).toContain('type="checkbox"')
  })
})
