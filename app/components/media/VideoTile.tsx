'use client'

import { useEffect, useRef, useState } from 'react'
import { Film } from 'lucide-react'
import { previewOf } from '../../lib/stream-client'
import { pickPoster } from '../../lib/stream-core'
import { useInView } from './useInView'

/**
 * A video's tile in a strip — a picture of the clip, never the clip.
 *
 * `<video preload="metadata">` was the tile for a while: it looked like a
 * thumbnail and cost the whole file, because on a .mov with its index at the
 * end "metadata" means "everything". Ten such tiles are ten downloads, and
 * two of them helped freeze a tab. `preload="none"` costs nothing and paints
 * nothing — a row of black squares.
 *
 * So the tile is an image: Cloudflare's still where the encode is ready (a
 * 20 KB JPEG, asked for once the tile is on screen), and a film glyph on a
 * dark square where it is not. It never becomes a `<video>`.
 */
export default function VideoTile({ url, className = 'h-full w-full' }: { url: string; className?: string }) {
  const [poster, setPoster] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box)

  useEffect(() => {
    if (!inView) return
    let live = true
    setPoster(null)
    // read-only: a tile asking for a still must never start an encode
    void previewOf(url).then(({ row }) => { if (live) setPoster(pickPoster(row)) })
    return () => { live = false }
  }, [url, inView])

  return (
    <div ref={box} className={`flex items-center justify-center bg-zinc-950 text-zinc-500 ${className}`} data-video-tile>
      {poster
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={poster} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        : <Film className="h-5 w-5" aria-hidden />}
    </div>
  )
}
