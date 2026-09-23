import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ICON_PARAMS, ICON_SIZES, iconLayout, isAppHost, isIconSize, manifestFor, parseIconParam } from '../app/lib/app-icon-core'

/**
 * AN ICON ON THE PHONE (the owner, 23 Sep 2026: "how do i make this into an
 * icon on the phone like an app").
 */
describe('added to a home screen', () => {
  it('the app host opens on the dashboard, the marketing host on the homepage, both with no address bar', () => {
    const app = manifestFor('app.mdmmarketing.com.au')
    expect(app.start_url).toBe('/dashboard')
    expect(app.name).toBe('MD Media — Agency OS')
    expect(app.display).toBe('standalone')
    expect(app.scope).toBe('/')
    const www = manifestFor('www.mdmmarketing.com.au')
    expect(www.start_url).toBe('/')
    expect(www.name).toBe('MD Media Marketing')
    expect(manifestFor(null).start_url).toBe('/')
    expect(isAppHost('app.mdmmarketing.com.au')).toBe(true)
    expect(isAppHost('APP.mdmmarketing.com.au')).toBe(true)
    expect(isAppHost('www.mdmmarketing.com.au')).toBe(false)
  })

  it('asks for the sizes Android installs from, plus a maskable copy for launchers that crop', () => {
    const icons = manifestFor('app.mdmmarketing.com.au').icons
    expect(icons.map(i => `${i.sizes}${i.purpose ? ` ${i.purpose}` : ''}`)).toEqual([
      '192x192', '512x512', '192x192 maskable', '512x512 maskable',
    ])
    expect(icons.every(i => i.type === 'image/png')).toBe(true)
    expect(icons.map(i => i.src)).toContain('/icons/512-maskable')
  })

  it('draws every size it offers, and refuses one it does not', () => {
    expect(ICON_SIZES).toEqual([180, 192, 512])
    expect(isIconSize('192')).toBe(true)
    expect(isIconSize(512)).toBe(true)
    expect(isIconSize('64')).toBe(false)
    expect(isIconSize('../../etc')).toBe(false)
    // the shape is in the address, not a query: a prerendered route ignores the query, so both
    // addresses answered with the same rounded picture (seen 23 Sep 2026, byte for byte identical)
    expect(ICON_PARAMS).toEqual(['180', '192', '512', '192-maskable', '512-maskable'])
    expect(parseIconParam('192')).toEqual({ size: 192, maskable: false })
    expect(parseIconParam('512-maskable')).toEqual({ size: 512, maskable: true })
    expect(parseIconParam('64-maskable')).toBeNull()
    expect(parseIconParam('maskable')).toBeNull()
    expect(parseIconParam(null)).toBeNull()
    // the maskable copy keeps the mark inside the circle a launcher crops to, so it is smaller and unrounded
    const plain = iconLayout(512, false), masked = iconLayout(512, true)
    expect(masked.fontSize).toBeLessThan(plain.fontSize)
    expect(masked.padding).toBeGreaterThan(plain.padding)
    expect(masked.radius).toBe(0)
    expect(plain.radius).toBeGreaterThan(0)
  })

  it('the pages carry the manifest, the Apple tags and an apple-touch-icon iOS does not round twice', () => {
    const layout = readFileSync('app/layout.tsx', 'utf8')
    expect(layout).toContain("manifest: '/manifest.webmanifest',")
    expect(layout).toContain('appleWebApp: {')
    expect(layout).toContain('capable: true,')
    expect(layout).toContain("themeColor: '#0A0A0A',")
    // both named on purpose: declaring icons at all stops Next linking app/apple-icon.tsx, and iOS before
    // 16.4 reads the apple-prefixed capable tag (both absent from the served head until 23 Sep 2026)
    expect(layout).toContain("apple: '/apple-icon',")
    expect(layout).toContain("other: { 'apple-mobile-web-app-capable': 'yes' },")
    const apple = readFileSync('app/apple-icon.tsx', 'utf8')
    expect(apple).toContain('export const size = { width: 180, height: 180 }')
    expect(apple).not.toContain('borderRadius')
    const icons = readFileSync('app/icons/[size]/route.tsx', 'utf8')
    expect(icons).toContain('export function generateStaticParams()')
    expect(icons).not.toContain('maskable=1')
    const route = readFileSync('app/manifest.webmanifest/route.ts', 'utf8')
    expect(route).toContain("const host = req.headers.get('host') ?? new URL(req.url).host")
    expect(route).toContain("'Content-Type': 'application/manifest+json',")
    // public on purpose: a phone fetches both before anyone signs in
    const middleware = readFileSync('middleware.ts', 'utf8')
    expect(middleware).not.toContain('/manifest')
    expect(middleware).not.toContain('/icons')
  })
})
