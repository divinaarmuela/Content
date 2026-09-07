'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, FileText, Film, ImageIcon, Link2, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import PlatformIcon from '../../dashboard/social/PlatformIcon'
import { tabTone, type ClientPreview } from '../../lib/post-preview-core'

/**
 * THE POST, AS EACH NETWORK WILL SHOW IT.
 *
 * ONE frame for every network. Everything that differs — the shape of the
 * picture, where the caption sits, where the words fold, whether there are
 * dots, a place, a first comment, a headline, a link card — arrives already
 * decided on the object, from the table in `post-preview-core`. So a new
 * network is a row in that table and nothing here changes.
 *
 * The same component serves three screens: the composer's Preview tab, the
 * reviewer's read-only copy, and the client's portal. The portal is handed
 * `ClientPreview` objects, which simply do not carry the refusals or the
 * account id — the component draws what it is given and asks for nothing.
 */

/** What the frame accepts: the client's copy, or the fuller internal one. */
export type PreviewFrameData = ClientPreview & {
  problems?: readonly string[]
  notes?: readonly string[]
}

/* ── the marks along the top, one per network ───────────────────────────── */

export function PreviewTabs({ previews, active, onPick, className }: {
  previews: readonly PreviewFrameData[]
  active: number
  onPick: (index: number) => void
  className?: string
}) {
  if (previews.length < 2) return null
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} role="tablist" aria-label="Networks">
      {previews.map((p, i) => {
        const wrong = tabTone(p) === 'problem'
        return (
          <button
            key={`${p.platform}-${i}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => onPick(i)}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold',
              i === active
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-surface hover:bg-muted',
            )}
          >
            <PlatformIcon platform={p.platform} size={18} className="rounded-full" />
            <span>{p.network}</span>
            {wrong && (
              <AlertTriangle
                className={cn('h-3.5 w-3.5', i === active ? 'text-background' : 'text-accent-red')}
                strokeWidth={2.4}
                aria-label="Something on this one would stop the post"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ── the picture, in the network's own crop ─────────────────────────────── */

function Frame({ media, aspect, label }: {
  media: PreviewFrameData['media'][number] | undefined
  aspect: string
  label: string
}) {
  return (
    <div
      style={{ aspectRatio: aspect }}
      className="relative w-full overflow-hidden bg-foreground/[0.06]"
    >
      {!media ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
          <ImageIcon className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          <span className="text-[12px]">Nothing picked yet</span>
        </span>
      ) : media.type === 'video' ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-ink text-cream">
          <Film className="h-6 w-6" strokeWidth={1.6} aria-hidden />
          <span className="text-[12px] opacity-80">Video — it plays here</span>
        </span>
      ) : media.type === 'document' ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
          <FileText className="h-6 w-6" strokeWidth={1.6} aria-hidden />
          <span className="text-[12px]">{media.name ?? 'A PDF'}</span>
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.url}
          alt={label}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )
}

/** The caption, folded where the network folds it. */
function Caption({ caption }: { caption: PreviewFrameData['caption'] }) {
  const [open, setOpen] = useState(false)
  if (!caption) return null
  if (!caption.shown && !caption.folded) return null
  return (
    <p className="whitespace-pre-wrap px-3 text-[13px] leading-[1.45]">
      {open ? `${caption.shown}${caption.rest ? ` ${caption.rest}` : ''}` : caption.shown}
      {caption.folded && !open && (
        <>
          {caption.shown ? '… ' : ''}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-semibold text-muted-foreground underline-offset-2 hover:underline"
          >
            {caption.more}
          </button>
        </>
      )}
    </p>
  )
}

/* ── one network's whole frame ──────────────────────────────────────────── */

export function PostPreviewFrame({ preview, className }: {
  preview: PreviewFrameData
  className?: string
}) {
  const [slide, setSlide] = useState(0)
  // the set can shrink under the picked slide while somebody is editing
  useEffect(() => { setSlide(s => (s < preview.media.length ? s : 0)) }, [preview.media.length])
  const shown = preview.media[slide] ?? preview.media[0]

  const caption = <Caption caption={preview.caption} />

  return (
    <div className={cn(
      'flex w-full max-w-[400px] flex-col overflow-hidden rounded-inner border border-border bg-surface',
      className,
    )}
    >
      {/* who it goes out as */}
      <div className="flex items-center gap-2.5 p-3">
        {preview.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        ) : (
          <PlatformIcon platform={preview.platform} size={36} className="shrink-0 rounded-full" />
        )}
        <span className="flex min-w-0 flex-1 flex-col leading-[1.2]">
          <span className="truncate text-[13px] font-semibold">{preview.handle}</span>
          <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            {preview.place ? (
              <>
                <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                {preview.place}
              </>
            ) : (
              preview.kindWord
            )}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
          {preview.kindWord}
        </span>
      </div>

      {preview.title && (
        <p className="px-3 pb-2 text-[15px] font-semibold leading-tight">{preview.title}</p>
      )}

      {preview.captionAbove && <div className="pb-3">{caption}</div>}

      <Frame media={shown} aspect={preview.aspect} label={preview.name} />

      {/* the dots under a carousel — and they move it */}
      {preview.dots && (
        <div className="flex items-center justify-center gap-1.5 py-2.5">
          {preview.media.map((m, i) => (
            <button
              key={`${m.url}-${i}`}
              type="button"
              aria-label={`Show slide ${i + 1} of ${preview.media.length}`}
              aria-current={i === slide}
              onClick={() => setSlide(i)}
              className="flex h-11 w-4 items-center justify-center"
            >
              <span className={cn(
                'block h-1.5 w-1.5 rounded-full',
                i === slide ? 'bg-foreground' : 'bg-foreground/25',
              )}
              />
            </button>
          ))}
        </div>
      )}

      {!preview.captionAbove && <div className="pt-3">{caption}</div>}

      {preview.link && (
        <a
          href={preview.link}
          target="_blank"
          rel="noreferrer noopener"
          className="mx-3 mt-3 flex min-h-11 items-center gap-2 rounded-tile border border-border bg-paper px-3 text-[12px] font-medium"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span className="truncate">{preview.link}</span>
        </a>
      )}

      {preview.firstComment && (
        <p className="mx-3 mt-3 rounded-tile bg-muted px-3 py-2 text-[12px] leading-[1.45]">
          <span className="font-semibold">{preview.handle}</span>{' '}
          {preview.firstComment}
        </p>
      )}

      <div className="p-3" />
    </div>
  )
}

/* ── the whole pane: the marks, the frame, and anything wrong ───────────── */

export default function PostPreviewPane({ previews, intro, empty, className }: {
  previews: readonly PreviewFrameData[]
  /** the sentence over the frame */
  intro?: string
  /** what to say when no channel is picked yet */
  empty?: string
  className?: string
}) {
  const [active, setActive] = useState(0)
  useEffect(() => { setActive(a => (a < previews.length ? a : 0)) }, [previews.length])
  const shown = previews[active] ?? previews[0] ?? null

  if (!shown) {
    return (
      <p className="rounded-inner border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
        {empty ?? 'Pick a channel and there will be something to look at.'}
      </p>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {intro && <p className="text-[12px] text-muted-foreground">{intro}</p>}
      <PreviewTabs previews={previews} active={active} onPick={setActive} />

      {/* what would stop this one going out — publish-core's own words */}
      {(shown.problems?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          {shown.problems!.map(p => (
            <p key={p} className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
              {p}
            </p>
          ))}
        </div>
      )}

      {(shown.notes?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          {shown.notes!.map(n => (
            <p key={n} className="rounded-inner border border-accent-amber/40 bg-tint-amber px-3 py-2 text-[12px] font-medium">
              {n}
            </p>
          ))}
        </div>
      )}

      <PostPreviewFrame preview={shown} />
    </div>
  )
}
