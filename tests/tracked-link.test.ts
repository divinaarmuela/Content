import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  clickDetail, clickPoints, destinationFor, isLinkPreviewBot, isProspectId, isTrackedKind, trackedLink, trackedPath, withUtm,
} from '../app/lib/tracked-link-core'

/** TRACKED LINKS (the acquisition blueprint, §8; built 22 Sep 2026). */
const p = { loom_url: 'https://www.loom.com/share/abc', post_url: '', cta_url: 'https://app.mdmmarketing.com.au/book/discovery?ref=x' }

describe('the address to paste', () => {
  it('is the app’s own, per prospect and per link', () => {
    expect(trackedPath('p1', 'loom')).toBe('/go/p1/loom')
    expect(trackedLink('https://app.mdmmarketing.com.au/', 'p1', 'cta')).toBe('https://app.mdmmarketing.com.au/go/p1/cta')
    expect(isTrackedKind('post')).toBe(true)
    expect(isTrackedKind('x')).toBe(false)
    expect(isProspectId('9a0e6b7c-1d2e-4f3a-8b9c-0d1e2f3a4b5c')).toBe(true)
    expect(isProspectId('../etc')).toBe(false)
  })
  it('stands for the prospect’s own link, and only a real web address', () => {
    expect(destinationFor(p, 'loom')).toBe('https://www.loom.com/share/abc')
    expect(destinationFor(p, 'post')).toBeNull()
    expect(destinationFor({ ...p, cta_url: 'javascript:alert(1)' }, 'cta')).toBeNull()
  })
})

describe('what a click is worth', () => {
  it('the first click is the intent signal; a second look is a note', () => {
    expect(clickPoints(0)).toBe(15)
    expect(clickPoints(1)).toBe(0)
    expect(clickDetail('loom', 0)).toBe('Opened the Loom or audit link')
    expect(clickDetail('cta', 2)).toBe('Opened the booking or CTA link · again')
  })
  it('a messenger’s preview fetch is not the prospect', () => {
    expect(isLinkPreviewBot('facebookexternalhit/1.1')).toBe(true)
    expect(isLinkPreviewBot('WhatsApp/2.23.20.0')).toBe(true)
    expect(isLinkPreviewBot('LinkedInBot/1.0')).toBe(true)
    expect(isLinkPreviewBot('')).toBe(true)
    expect(isLinkPreviewBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe(false)
  })
  it('UTM rides along unless the destination carries its own', () => {
    expect(withUtm('https://www.loom.com/share/abc', 'The Glass Den')).toBe('https://www.loom.com/share/abc?utm_source=mdmedia&utm_medium=outreach&utm_campaign=the-glass-den')
    expect(withUtm('https://x.test/?utm_source=theirs', 'Glass')).toBe('https://x.test/?utm_source=theirs')
    expect(withUtm('not a url', 'x')).toBe('not a url')
  })
})

describe('the route and the sheet', () => {
  it('the route is public by design, answers only a real prospect’s own link, and never lets recording block the redirect', () => {
    const route = readFileSync('app/go/[id]/[kind]/route.ts', 'utf8')
    expect(route).toContain("if (!isProspectId(id) || !isTrackedKind(kind)) return new Response('Not found', { status: 404 })")
    expect(route).toContain("if (!p || !to) return new Response('Not found', { status: 404 })")
    expect(route).toContain("if (!isLinkPreviewBot(req.headers.get('user-agent'))) {")
    expect(route).toContain("try { await recordLinkClick(p, kind) } catch (e) { console.error('[acquisition] click not recorded:', e) }")
    expect(route).toContain('status: 302')
    // trap 8: the middleware protects by allowlist; /go is not on it, so it stays public
    expect(readFileSync('middleware.ts', 'utf8')).not.toContain("'/go")
  })
  it('a first click makes a target at Outreach a lead and tells its owner; the reminders keep going', () => {
    const s = readFileSync('app/lib/acquisition.ts', 'utf8')
    expect(s).toContain('export async function recordLinkClick(p: ProspectRow, kind: TrackedKind): Promise<ProspectEvent> {')
    expect(s).toContain("detail: 'Moved to New lead / Engaged — they opened the link'")
    expect(s).toContain("event: 'acq_click'")
    const body = s.slice(s.indexOf('export async function recordLinkClick'), s.indexOf('/** A REPLY → the no-response reminders stop'))
    expect(body).not.toContain('onReply(')
  })
  it('the sheet offers the three links to paste, each only once its address is filled in', () => {
    const sheet = readFileSync('app/dashboard/leads/acquisition/ProspectSheet.tsx', 'utf8')
    expect(sheet).toContain('{TRACKED_KINDS.map(k => (')
    expect(sheet).toContain('disabled={!destinationFor(p, k)}')
    expect(sheet).toContain('copyText(trackedLink(window.location.origin, p.id, k))')
  })
})
