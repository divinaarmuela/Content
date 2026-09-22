import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A POST THAT KEPT A DRIVE LINK AS A LINK IS PUT RIGHT ON THE NEXT VISIT
 * (22 Sep 2026: twenty globes on The Glass Den's posting-order board, pasted
 * before the info route could read a link-shared file).
 */
describe('the canvas heals a post whose link box holds a Drive file link', () => {
  const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
  it('once per card per visit, quietly, never when the board is read only', () => {
    expect(canvas).toContain('const healedRef = useRef<Set<string>>(new Set())')
    expect(canvas).toContain("if (c.kind !== 'mockup' || c.drive_files?.length || healedRef.current.has(c.id)) continue")
    expect(canvas).toContain('if (!driveFileIdFromLink(url)) continue')
    expect(canvas).toContain('void attachDriveLinkRef.current(c, url, true)')
    expect(canvas.replace(/\r\n/g, '\n')).toMatch(/useEffect\(\(\) => \{\n\s+if \(readOnly\) return\n\s+for \(const c of cards\)/)
  })
  it('the quiet attach says nothing either way', () => {
    expect(canvas).toContain('const attachDriveLinkToMockup = async (card: CanvasCard, url: string, quiet = false) => {')
    expect(canvas).toContain("if (!quiet) toast.success(driveFilesWords(next.drive_files) ?? 'Put on the post')")
    expect(canvas).toContain("} catch { if (!quiet) toast.error('Could not read that Drive file just now') }")
  })
})
