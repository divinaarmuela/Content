import { describe, expect, it } from 'vitest'
import { buttonVariants } from '@/components/ui/button'

/**
 * A call site is allowed to shrink a button on a desktop (`h-7 w-7` on an
 * icon button in a dense table row), and its className wins over the cva
 * size. What it must NOT do is shrink the thing a fingertip has to hit, so
 * the cva BASE — which every variant and size carries — keeps a 44px floor
 * behind a coarse-pointer media query. Losing these two classes is invisible
 * on a laptop and breaks every small button on a phone, which is exactly how
 * they went missing once already.
 */
describe('button touch-target floor', () => {
  it('keeps a 44px min height and width on coarse pointers', () => {
    const base = buttonVariants({ variant: 'ghost', size: 'icon' })
    expect(base).toContain('[@media(pointer:coarse)]:min-h-11')
    expect(base).toContain('[@media(pointer:coarse)]:min-w-11')
  })

  it('carries the floor on every variant and size', () => {
    const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const
    const sizes = ['default', 'sm', 'lg', 'icon'] as const
    for (const variant of variants) {
      for (const size of sizes) {
        const cls = buttonVariants({ variant, size })
        expect(cls, `${variant}/${size}`).toContain('[@media(pointer:coarse)]:min-h-11')
        expect(cls, `${variant}/${size}`).toContain('[@media(pointer:coarse)]:min-w-11')
      }
    }
  })

  it('adds no desktop height of its own — the size variant still decides', () => {
    // the floor is inside a media query, so nothing about a mouse changes
    expect(buttonVariants({ size: 'default' })).toContain('h-11 px-5')
    expect(buttonVariants({ size: 'icon' })).toContain('h-11 w-11')
  })
})
