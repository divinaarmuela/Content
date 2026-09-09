import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

/**
 * THE WINDOW MAY CLOSE; THE UPLOAD MAY NOT BE LOST.
 *
 * The owner, 9 Sep 2026, seven minutes into a 1.4 GB upload: "when I close
 * the modal it does not work". Both windows that upload a file for a post —
 * New post on Schedule, New post on Post approval — cleared their upload
 * group on unmount, so closing the window threw the landed file away while
 * the tray underneath promised "you can keep working anywhere".
 *
 * Read off the source, because the rule is a shape: no unmount clear, a
 * pick-up of landed rows, and a clear only when the post is made.
 */
const WINDOWS = [
  'app/dashboard/social/schedule/NewPostSources.tsx',
  'app/dashboard/scheduler/SendForApprovalDialog.tsx',
]

describe('an upload outlives the window that started it', () => {
  it('neither window clears its upload group on unmount any more', () => {
    for (const w of WINDOWS) {
      expect(read(w), w).not.toMatch(/useEffect\(\(\) => \(\) => clearGroup\(group\)/)
    }
  })

  it('both pick up rows that landed while they were closed', () => {
    for (const w of WINDOWS) {
      const src = read(w)
      expect(src, w).toMatch(/uploads\.filter\(u => u\.status === 'done' && u\.url\)/)
      // …and remove the queue row when a file is taken out, or it comes back
      expect(src, w).toMatch(/dismissUpload\(u\.id\)/)
      // …and clear the group once the post exists
      expect(src, w).toMatch(/clearGroup\(group\)/)
    }
  })

  it('the tray keeps a landed New post file through "dismiss finished" and says where it is', () => {
    const queue = read('app/dashboard/uploadQueue.ts')
    expect(queue).toMatch(/export function awaitingPickup/)
    expect(queue).toMatch(/startsWith\('new-post:'\)/)
    expect(queue).toMatch(/startsWith\('approval:'\)/)
    expect(queue).toMatch(/!isSettled\(u\.status\) \|\| awaitingPickup\(u\)/)
    const tray = read('app/dashboard/UploadTray.tsx')
    expect(tray).toContain('uploads.some(awaitingPickup)')
    expect(tray).toContain('open it again and the file is already picked')
  })
})
