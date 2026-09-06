import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE EXPANDED BOARD SITS ABOVE THE PAGE'S OWN CONTROLS.
 *
 * The owner: "the dark mode and light mode button is blocking the zoom-out
 * and full-screen card when the board is opened." Two fixed controls own a
 * corner of the window — the dashboard header (top, z-20) and the portal's
 * theme pill (bottom right from sm up, z-50) — and the board's zoom cluster
 * lived in one of them. Two rules, read straight from the source so a
 * restyle cannot quietly undo them:
 *
 *  1. the expanded board's cover has a HIGHER z-index than both, so nothing
 *     of the page floats over it;
 *  2. the zoom cluster is not in a corner the page uses — bottom LEFT.
 */

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** every Tailwind z-index on the line(s) that match `on` */
function zOf(src: string, on: RegExp): number[] {
  const out: number[] = []
  for (const line of src.split('\n')) {
    if (!on.test(line)) continue
    for (const m of line.matchAll(/\bz-(?:\[(\d+)\]|(\d+)\b)/g)) out.push(Number(m[1] ?? m[2]))
  }
  return out
}

describe('the expanded board is above the page', () => {
  const canvas = read('app/dashboard/production/shoots/[id]/BriefCanvas.tsx')
  const shell = read('app/dashboard/ui/Shell.tsx')
  const portal = read('app/components/portal/PortalShell.tsx')

  const cover = Math.max(...zOf(canvas, /fixed inset-0/))
  it('the cover has a z-index at all', () => {
    expect(Number.isFinite(cover)).toBe(true)
  })

  it("is above the dashboard header's toggle", () => {
    const header = zOf(shell, /<header/)
    expect(header.length).toBeGreaterThan(0)
    expect(cover).toBeGreaterThan(Math.max(...header))
    // the toggle itself is inside the header, not fixed on its own
    expect(zOf(shell, /onClick=\{onToggleTheme\}/)).toEqual([])
  })

  it("is above the portal's theme pill", () => {
    const pill = zOf(portal, /onClick=\{flip\}|portal-tap fixed/)
    expect(pill.length).toBeGreaterThan(0)
    expect(cover).toBeGreaterThan(Math.max(...pill))
  })

  it('the zoom cluster is bottom LEFT, out of both corners the page uses', () => {
    const line = canvas.split('\n').find(l => l.includes('data-canvas-zoom'))
    expect(line).toBeDefined()
    expect(line).toMatch(/\bbottom-3\b/)
    expect(line).toMatch(/\bleft-3\b/)
    expect(line).not.toMatch(/\bright-\d/)
  })
})
