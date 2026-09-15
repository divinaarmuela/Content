import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SEE THE FILES ON THE CARD (the owner, 15 Sep 2026: "in Editor, can we
 * display files as their thumbnail and play it from there?").
 *
 * The Files to work from box draws every file as a picture — the image, or
 * Cloudflare's still of the clip — and pressing the tile opens the file
 * above the grid, where a clip plays and a still shows large. Pinned on the
 * source, so a rewrite back to a film glyph and a download link fails a
 * test rather than a tutorial.
 */
describe('the files box shows thumbnails and plays a clip on the card', () => {
  const s = readFileSync(join(process.cwd(), 'app/dashboard/board/FilesToWorkFrom.tsx'), 'utf8')

  it('a clip’s tile is a still (VideoTile), never a <video>, with a play mark on it', () => {
    expect(s).toContain("import VideoTile from '../../components/media/VideoTile'")
    expect(s).toContain('<VideoTile url={f.url} className="h-full w-full" />')
    expect(s).toContain('<Play className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden />')
    // the tile is a button, named for what it does
    expect(s).toContain('aria-label={`${kind === \'video\' ? \'Play\' : \'See\'} ${f.name}`}')
    expect(s).toContain('onClick={() => setShowing(open ? null : f)} aria-pressed={open}')
  })

  it('pressing a tile opens the file above the grid: a clip plays (SafeVideo, on the press), a still shows large', () => {
    expect(s).toContain("import SafeVideo from '../../components/media/SafeVideo'")
    expect(s).toContain('<SafeVideo key={showing.url} src={showing.url} autoStart ariaLabel={showing.name}')
    expect(s).toContain('<img src={showing.url} alt={showing.name} className="max-h-[60vh] w-full rounded-tile bg-foreground/[0.06] object-contain" />')
    expect(s).toContain('aria-label={`Close ${showing.name}`}')
    // a new card closes the viewer
    expect(s).toContain('useEffect(() => { setShowing(null) }, [item.id])')
  })

  it('the file the tile stands for is still downloadable from the row', () => {
    expect(s).toContain('<a href={f.url} target="_blank" rel="noreferrer noopener" download')
  })
})
