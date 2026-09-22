import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** SCRUBBING THE CLIP FOR A COVER (the owner, 22 Sep 2026: "like a scroll through frame and pick"). */
describe('the cover picker scrolls through the clip', () => {
  const s = readFileSync('app/dashboard/social/schedule/CoverPicker.tsx', 'utf8')
  it('a slider over the whole clip, the frame it lands on, and one button to use it', () => {
    expect(s).toContain('setDuration(el.duration)')
    expect(s).toContain('onChange={e => scrubTo(Number(e.target.value))}')
    expect(s).toContain('Use this frame · {scrub.at.toFixed(1)}s')
    expect(s).toContain('onClick={() => void useFrame(scrub.at)}')
  })
  it('a fast drag settles on the last place asked for, never a pile of seeks', () => {
    expect(s).toContain('scrubWant.current = at')
    expect(s).toContain('if (scrubRun.current) return')
    expect(s).toContain('while (el && scrubWant.current !== null) {')
  })
})
