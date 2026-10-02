'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PortalCard } from '../../lib/portal-data'
import { portalPostHref } from '../../lib/post-page-core'
import { PostMetricsRow } from './PortalSections'
import type { Surface } from './PortalBoard'

const TONE: Record<NonNullable<PortalCard['tone']>, string> = {
  amber: 'bg-tint-amber',
  green: 'bg-tint-green',
  blue: 'bg-tint-blue',
  ink: 'border border-border bg-surface',
}

/**
 * ONE POST ON THE CLIENT'S PAGE (the posting rebuild, 29 Sep 2026).
 *
 * Everything on it comes from the post's stage and the version the client was
 * shown — never the edit card's fields, never the live post (SPEC §4.4). It
 * says one true thing ("You approved this", "Approved by Divina for you",
 * "Live on Instagram") and links to the post's own page, where the whole post
 * is. A live post lists one link per network, each to that network's post.
 */
export default function PortalPostCard({ card, surface, className }: {
  card: PortalCard
  surface: Surface
  className?: string
}) {
  const face = card.post
  if (!face) return null
  const token = 'token' in surface ? surface.token : null
  const href = token ? portalPostHref(token, card.id) : null
  const muted = 'text-muted-foreground'

  const cover = face.cover && (
    face.cover.type === 'video'
      ? <video src={`${face.cover.url}#t=0.001`} muted playsInline preload="metadata" className="max-h-[320px] w-full object-cover" />
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={face.cover.url} alt="" loading="lazy" className="max-h-[320px] w-full object-cover" />
  )

  return (
    <article
      data-tone={card.tone ?? 'surface'}
      data-portal-card={`post-${card.id}`}
      data-post-state={face.state}
      className={cn(
        'relative flex h-full flex-col gap-2.5 rounded-inner p-3.5 text-foreground',
        card.tone ? TONE[card.tone] : 'border border-border bg-surface',
        className,
      )}
    >
      {cover && (href ? (
        <Link href={href} className="relative block overflow-hidden rounded-tile bg-foreground/[0.06]" aria-label={`Open ${card.title}`}>
          {cover}
          {face.files > 1 && (
            <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[12px] font-semibold text-white">1 of {face.files}</span>
          )}
        </Link>
      ) : (
        <div className="relative overflow-hidden rounded-tile bg-foreground/[0.06]">{cover}</div>
      ))}
      <div className="flex items-center gap-2">
        {card.word && <span className={cn('text-[12px] font-semibold uppercase tracking-[0.02em]', muted)}>{card.word}</span>}
        {face.networks.length > 0 && <span className={cn('ml-auto text-[12px]', muted)}>{face.networks.join(' · ')}</span>}
      </div>
      {href ? (
        <Link href={href} className="text-[16px] font-semibold leading-[1.25] underline-offset-4 hover:underline">{card.title}</Link>
      ) : (
        <span className="text-[16px] font-semibold leading-[1.25]">{card.title}</span>
      )}
      <p className="text-[14px] font-semibold">{face.headline}</p>
      {face.line && <p className={cn('text-[14px]', muted)}>{face.line}</p>}
      {card.posted_when && face.state === 'posted' && <p className={cn('text-[13px]', muted)}>Went out {card.posted_when}</p>}

      {face.links.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {face.links.map(l => (
            <a key={l.platform} href={l.url} target="_blank" rel="noreferrer noopener"
              className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-semibold underline-offset-4 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> See it on {l.network}
            </a>
          ))}
        </div>
      )}
      {card.metrics && <div><PostMetricsRow item={{ metrics: card.metrics } as never} /></div>}
      {href && (
        <Link href={href}
          className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border px-5 text-[14px] font-semibold hover:bg-muted">
          {face.state === 'posted' ? 'How this post did' : 'Open the post'}
        </Link>
      )}
    </article>
  )
}
