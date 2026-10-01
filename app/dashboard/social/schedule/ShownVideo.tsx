'use client'

import { useCallback, useMemo, useRef } from 'react'
import { Film } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import type { EncodeJob } from '@/lib/db-types'
import { cn } from '@/lib/utils'
import { needsPreviewCopy, playableUrl, shownVideo, type ShownVideo } from '../../../lib/playable-core'
import type { Slide } from '../../../lib/version-files-core'
import { usePreviewRows } from '../../../components/media/usePreviewRows'
import { useHlsSource } from '../../../components/media/useHlsSource'

/**
 * A .MOV IS NOT A BLACK BOX (1 Oct 2026). A draft made from an edit card's .mov original showed an
 * empty black box with a film icon in the post window: Chrome cannot decode it, and a draft with no
 * channel has no encoder copy yet. The editor's card already asks Cloudflare Stream for a preview of
 * the same file (`usePreviewRows`) — the window shows that one; with none ready it shows the file's
 * still (the Drive thumbnail of a Drive hand-in) and says the preview is being made.
 *
 * Only what is SHOWN changes. The post's slides — what is published — are never touched here.
 */
export function useShownVideos(slides: readonly Pick<Slide, 'url' | 'type' | 'drive_file_id'>[]): (url: string) => ShownVideo {
  const { rows } = useTable<EncodeJob>('encode_jobs')
  // a preview is asked for only where it is needed: a .mov with no encoder copy
  const asks = useMemo(() => [...new Set(slides
    .filter(s => s.type === 'video' && needsPreviewCopy(s.url) && playableUrl(s.url, rows) === s.url)
    .map(s => s.url))], [slides, rows])
  const previews = usePreviewRows(asks)
  const driveIds = useMemo(() => new Map(slides.filter(s => s.drive_file_id).map(s => [s.url, String(s.drive_file_id)])), [slides])
  return useCallback((url: string) => {
    const drive = driveIds.get(url)
    return shownVideo({
      url,
      encodeRows: rows,
      stream: previews.get(url) ?? null,
      thumb: drive ? `/api/drive/thumbnail?id=${encodeURIComponent(drive)}` : null,
    })
  }, [rows, previews, driveIds])
}

/**
 * A video the browser cannot play as it is: Cloudflare's stream (with its still as the poster), or the
 * still and the words while the preview is made. `compact` (a strip tile) leaves the words out.
 */
export function ShownVideoBox({ shown, label, className, controls = true, compact = false }: {
  shown: Exclude<ShownVideo, { kind: 'file' }>
  label: string
  className?: string
  controls?: boolean
  compact?: boolean
}) {
  if (shown.kind === 'stream') return <StreamVideo hls={shown.hls} poster={shown.poster} label={label} className={className} controls={controls && !compact} />
  return (
    <div className={cn('relative flex flex-col items-center justify-center gap-1.5 overflow-hidden bg-ink px-3 text-center text-cream', className)} data-preview-waiting>
      {shown.poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown.poster} alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-70" />
      )}
      <Film className="relative h-5 w-5" strokeWidth={1.6} aria-hidden />
      {compact
        ? <span className="sr-only">{shown.words}</span>
        : <span className="relative rounded-full bg-ink/70 px-2 py-0.5 text-[12px] font-medium">{shown.words}</span>}
      <span className="sr-only">{label}</span>
    </div>
  )
}

function StreamVideo({ hls, poster, label, className, controls }: { hls: string; poster: string | null; label: string; className?: string; controls: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useHlsSource(ref, hls)
  return (
    <video ref={ref} poster={poster ?? undefined} controls={controls} muted playsInline preload="none"
      aria-label={label} className={cn('bg-ink object-contain', className)} />
  )
}
