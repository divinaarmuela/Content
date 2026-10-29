import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 29 Oct 2026: "mobile portal schedule approve popup is too large can exit from top"
describe('the portal post sheet on a phone', () => {
  const s = readFileSync('app/components/portal/OnePortalScheduling.tsx', 'utf8')
  it('is sized on the visible screen and kept clear of the notch, so Close stays in reach', () => {
    expect(s).toContain('supports-[height:100dvh]:max-h-[85dvh]')
    expect(s).toContain('pt-[max(env(safe-area-inset-top),12px)]')
    expect(s).not.toContain('max-h-[92vh] w-full')
  })
  it('draws the post smaller on a phone, so the answer is close by', () => {
    expect(s).toContain('max-w-[min(420px,30dvh)] sm:max-w-[420px]')
  })
})
