import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { connectLinkPath, parseInbox, scopesFor } from '../app/lib/connect-link-core'

/**
 * THE MESSAGE INBOX, ON OR OFF, PER CONNECT LINK (the owner, 16 Oct 2026: "does our link include toggling on and off for
 * message inbox?… for instagram"). Zernio asks the network for every permission unless told otherwise; leaving out its
 * `messaging` area means Instagram (and Facebook) never grant message access, so that account has no inbox. It is
 * decided at sign-in — turning it on later means reconnecting (docs.zernio.com/guides/connecting-accounts, "scopes").
 */
describe('the link carries the choice', () => {
  const T = '8535c670-33ae-4940-b0ad-cc76a2c07bae'
  it('on (the default) adds nothing — every link made before still means "everything"', () => {
    expect(connectLinkPath(T, ['instagram', 'facebook', 'tiktok'])).toBe(`/connect/${T}?networks=instagram,facebook,tiktok`)
    expect(connectLinkPath(T, ['instagram'], null, true)).toBe(`/connect/${T}?networks=instagram`)
  })
  it('off adds inbox=0, after the person', () => {
    expect(connectLinkPath(T, ['instagram'], 'abc', false)).toBe(`/connect/${T}?networks=instagram&for=abc&inbox=0`)
  })
  it('only an explicit 0 / off / false turns it off', () => {
    for (const v of ['0', 'off', 'false', false]) expect(parseInbox(v)).toBe(false)
    for (const v of [undefined, null, '', '1', 'yes', 'nonsense', true]) expect(parseInbox(v)).toBe(true)
  })
})

describe('what Zernio is asked for', () => {
  it('inbox on: nothing passed, so Zernio asks for every area, exactly as today', () => {
    expect(scopesFor('instagram', true)).toBeNull()
    expect(scopesFor('facebook', true)).toBeNull()
  })
  it('inbox off on Instagram: posting, analytics and comments — never messaging', () => {
    expect(scopesFor('instagram', false)).toBe('posting,analytics,comments')
  })
  it('inbox off on Facebook keeps its ads area, only messaging is left out', () => {
    expect(scopesFor('facebook', false)).toBe('posting,analytics,comments,ads')
  })
  it('a network with no inbox is never sent scopes (TikTok, LinkedIn, YouTube…)', () => {
    for (const p of ['tiktok', 'linkedin', 'youtube', 'threads', 'x', 'pinterest']) expect(scopesFor(p, false)).toBeNull()
  })
})

describe('wired through', () => {
  it('the publisher sends `scopes` to Zernio only when given one', () => {
    const s = readFileSync('app/lib/publisher.ts', 'utf8')
    expect(s).toContain("if (scopes) qs.set('scopes', scopes)")
  })
  it('the connect route reads the link\'s inbox choice and asks for the matching scopes', () => {
    const s = readFileSync('app/api/connect/[token]/route.ts', 'utf8')
    expect(s).toContain('parseInbox(body.inbox)')
    expect(s).toContain('scopes: scopesFor(body.platform, inbox)')
  })
  it('the client\'s page sends the link\'s choice back with each press', () => {
    const s = readFileSync('app/connect/[token]/ConnectNetworks.tsx', 'utf8')
    expect(s).toContain('inbox: inbox ? undefined : 0')
  })
})
