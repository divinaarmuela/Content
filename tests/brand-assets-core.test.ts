import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MAX_BRAND_ASSET_BYTES, assetKind, brandAssetProblem, bytesWords, portalBrandFiles, withBrandFile } from '../app/lib/brand-assets-core'
import { brandAssetsUrl } from '../app/lib/onboarding-email-core'
import { PORTAL_TABS, readTab } from '../app/lib/one-portal-core'

describe('Brand assets on the portal (the owner, 13 Nov 2026)', () => {
  it('is a tab on the portal', () => {
    expect(PORTAL_TABS.at(-1)).toEqual({ key: 'brand', label: 'Brand assets' })
    expect(readTab('brand')).toBe('brand')
  })
  it('lists the guideline PDFs first, then the brand files, each once, and only real addresses', () => {
    const files = portalBrandFiles(
      [{ filename: 'Guidelines.pdf', url: 'https://files.example/a.pdf', scanned_at: 'x' }],
      [{ name: 'Logo.svg', url: 'https://files.example/logo.svg' }, { name: 'Again', url: 'https://files.example/a.pdf' }, { name: 'Bad', url: 'javascript:alert(1)' }],
    )
    expect(files.map(f => [f.name, f.source, f.kind])).toEqual([['Guidelines.pdf', 'guide', 'PDF'], ['Logo.svg', 'file', 'Picture']])
    expect(portalBrandFiles(null, undefined)).toEqual([])
    // the database hands a list back as a keyed object sometimes
    expect(portalBrandFiles({ k1: { filename: 'G.pdf', url: 'https://files.example/g.pdf' } }, null)).toHaveLength(1)
  })
  it('takes the same kinds of file as the dashboard Brand tab, up to 1 GB', () => {
    const dash = readFileSync('app/api/clients/[id]/brand/route.ts', 'utf8')
    const same = '/\\.(png|jpe?g|webp|gif|svg|avif|heic|pdf|ai|eps|psd|indd|fig|sketch|zip|otf|ttf|woff2?|mp4|mov)$/i'
    expect(dash).toContain(`const BRAND_ASSET_EXT = ${same}`)
    expect(readFileSync('app/lib/brand-assets-core.ts', 'utf8')).toContain(`export const BRAND_ASSET_EXT = ${same}`)
    expect(MAX_BRAND_ASSET_BYTES).toBe(1024 * 1024 * 1024)
    for (const ok of ['logo.PNG', 'guide.pdf', 'brand.ai', 'fonts.zip', 'Inter.woff2', 'film.mov']) expect(brandAssetProblem(ok, 5000)).toBeNull()
    expect(brandAssetProblem('virus.exe', 5000)).toMatch(/not a brand file/)
    expect(brandAssetProblem('notes.docx', 5000)).toMatch(/not a brand file/)
    expect(brandAssetProblem('big.mov', MAX_BRAND_ASSET_BYTES + 1)).toMatch(/over 1 GB/)
    expect(brandAssetProblem('empty.png', 0)).toMatch(/empty/)
  })
  it('adds a file to the brand list once, and never past its cap', () => {
    const one = withBrandFile([], { name: ' Logo.svg ', url: 'https://f/x.svg' })
    expect(one).toMatchObject({ added: true, files: [{ name: 'Logo.svg', url: 'https://f/x.svg' }] })
    expect(withBrandFile(one.files, { name: 'Logo.svg', url: 'https://f/x.svg' })).toMatchObject({ added: false, full: false })
    const full = Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, url: `https://f/${i}` }))
    expect(withBrandFile(full, { name: 'more', url: 'https://f/more' })).toMatchObject({ added: false, full: true })
  })
  it('says what a file is and how big', () => {
    expect([assetKind('a.ttf'), assetKind('a.psd'), assetKind('a.mp4'), assetKind('a.zip'), assetKind('a')]).toEqual(['Font', 'Design file', 'Video', 'Zip', 'File'])
    expect([bytesWords(900), bytesWords(2.4 * 1024 * 1024), bytesWords(1.5 * 1024 ** 3)]).toEqual(['1 KB', '2.4 MB', '1.5 GB'])
  })
})

describe('Brand assets: the route and where a file lands', () => {
  const route = readFileSync('app/api/portal/brand/route.ts', 'utf8')
  const lib = readFileSync('app/lib/brand-assets.ts', 'utf8')
  it('only the business link adds, only files in our storage, only once storage has them', () => {
    expect(route).toContain("if (owner.scope.kind !== 'business')")
    expect(route).toContain('!f.url.startsWith(`${base}/`)')
    expect(route).toContain('const stored = await headStoredObject(f.url)')
    expect(route).toContain('brandAssetProblem(name, size)')
  })
  it('a file joins the brand profile the dashboard reads, seeded from the scan first, and written against its revision', () => {
    expect(lib).toContain('const loaded = await loadBrandProfile(clientId, `portal:${who}`)')
    expect(lib).toContain("const stillTheirs = seen > 0 ? String(liveRev ?? '') === String(seen) : cur.brand_profile == null")
    expect(lib).toContain('logo_files: next.files, rev: seen + 1')
  })
  it('the managers are told in the bell, with no email, and the client never is', () => {
    expect(lib).toContain('bellOnly: true')
    expect(lib).toContain("u.role === 'account_manager' || u.role === 'super_admin'")
    expect(lib).not.toMatch(/toClient: true|deliberateClientSend/)
  })
  it('the welcome email sends them to the tab', () => {
    expect(brandAssetsUrl('https://app.example.test/portal/abc')).toBe('https://app.example.test/portal/abc/home?tab=brand')
    expect(brandAssetsUrl('https://app.example.test/portal/abc/home/')).toBe('https://app.example.test/portal/abc/home?tab=brand')
    expect(readFileSync('app/emails/OnboardingEmail.tsx', 'utf8')).toContain('<Pill href={brandAssetsUrl(portalUrl)}')
  })
})

describe('a new client is on the one portal, and an old-portal client never gets "page not found" (13 Nov 2026)', () => {
  it('every route that makes a client sets the one-portal switch with the link', () => {
    for (const f of ['app/api/website/clients/route.ts', 'app/api/website/clients/convert-lead/route.ts', 'app/api/leads/acquisition/[id]/stage/route.ts']) {
      const s = readFileSync(f, 'utf8')
      expect(s, f).toMatch(/share_token: randomUUID\(\),[\s\S]{0,400}portal_one: true,/)
    }
  })
  it('a one-portal address for a client on the old portal opens the portal they have', () => {
    const page = readFileSync('app/portal/[token]/home/page.tsx', 'utf8')
    expect(page).toContain('if (!page) { const old = await oldPortalPathFor(raw); if (old) redirect(old) }')
    expect(page).toMatch(/if \(!page\) notFound\(\)/)
    const load = readFileSync('app/lib/one-portal-load.ts', 'utf8')
    expect(load).toContain('if (!owner || onePortal(owner.client)) return null')
  })
  it('the welcome email leaves the brand files button out for a client whose portal has no such tab', () => {
    expect(readFileSync('app/emails/OnboardingEmail.tsx', 'utf8')).toContain('{portalUrl && brandTab && d.needButton.trim() && (')
    expect(readFileSync('app/api/clients/[id]/onboarding/route.ts', 'utf8')).toContain('brand_tab: client.portal_one === true,')
  })
})
