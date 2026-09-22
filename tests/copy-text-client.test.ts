import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A COPY CLAIMED INSIDE THE PRESS (Karly, 22 Sep 2026: "clicking 'copy portal
 * link' and it's not copying"): text that arrives after a fetch or a save is
 * written through a promise-valued ClipboardItem, so Safari does not let go
 * of the press first; when the browser still refuses, the text is shown to
 * select rather than a "could not copy" over a link that was fine.
 */
describe('copying text that is not ready yet', () => {
  const helper = readFileSync('app/lib/copy-text-client.ts', 'utf8')
  it('claims the write inside the press, falls back to the plain write, and says when neither landed', () => {
    expect(helper).toContain("await navigator.clipboard.write([new Item({ 'text/plain': blob as unknown as Blob })])")
    expect(helper).toContain('await navigator.clipboard.writeText(await text)')
    expect(helper).toContain('return false')
  })
  it('the shoot page’s three copies go through it and show the text when the browser refuses', () => {
    const sop = readFileSync('app/dashboard/production/shoots/[id]/ShootSop.tsx', 'utf8')
    expect(sop).toContain('const link = portalLinkFor()')
    expect(sop).toContain('void copyText(link)')
    expect(sop.split('Could not copy it here — select it:').length).toBe(3)
    expect(sop).not.toContain('navigator.clipboard.writeText')
    const page = readFileSync('app/dashboard/production/shoots/[id]/page.tsx', 'utf8')
    expect(page).toContain('if (await copyText(pending)) { toast.success(\'Details copied\'); return }')
    expect(page).toContain('setDetailsToSelect(await pending)')
    expect(page).not.toContain('navigator.clipboard.writeText')
  })
})
