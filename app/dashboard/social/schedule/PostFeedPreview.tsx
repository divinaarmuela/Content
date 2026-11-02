'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { feedPreviewNote, networkFeedPreview, type FeedPreviewTile } from '@/app/lib/portal-core'
import type { LiveTile } from '@/app/lib/feed-preview-core'
import type { PostState } from '@/app/lib/post-stage-core'
import { formatInZone } from '@/app/lib/timezone-core'
import { networkName } from '@/app/lib/publish-core'
import PlatformIcon from '../PlatformIcon'

/**
 * THE FEED PREVIEW TAB (the owner, 2 Nov 2026: "make sure it shows how it sits on instagram facebook tiktok or
 * linkedin feed preview tab new one and in there they can choose … include scheduled ones too current updated").
 *
 * One button per network this post goes to; the chosen one draws the client's account as it will read: the other
 * BOOKED posts going to that same account with this post in its place, latest first, each badged with its time,
 * then what is live there now — the same `portal_feeds` copy the client portal's "Your feed" reads
 * (/api/social/schedule/feed → `feedFor`). Instagram and TikTok are grids (4:5 and 9:16); Facebook and LinkedIn
 * are a feed of cards. Read only: it fetches, it never writes.
 */

const NETWORKS = ['instagram', 'facebook', 'tiktok', 'linkedin'] as const
const MELBOURNE = 'Australia/Melbourne'

type Account = { id: string; platform: string; username?: string | null; name?: string | null }
type FeedState = { tiles: LiveTile[]; state: 'reading' | 'read' | 'unreadable' }

export default function PostFeedPreview({
  post, others, accounts, known, media,
}: {
  post: Parameters<typeof networkFeedPreview>[0]
  /** the client's posts (any stage — only the booked ones on the chosen account are drawn) */
  others: readonly PostState[]
  /** every account of the client, to name and pick the post's channels */
  accounts: readonly Account[]
  /** feeds the window has already read (its Instagram grid), so they are not fetched twice */
  known?: Record<string, LiveTile[] | null>
  /** how the window draws one of its own pictures or videos (a .mov's Stream still, never a black box) */
  media: (tile: { url: string; type: 'image' | 'video' }, label: string) => ReactNode
}) {
  // the post's channels on the four networks, in that order — one button each
  const channels = useMemo(() => NETWORKS.flatMap(n =>
    post.channels.map(id => accounts.find(a => a.id === id)).filter((a): a is Account => !!a && String(a.platform) === n)), [post.channels, accounts])
  const [pickedId, setPickedId] = useState<string | null>(null)
  const picked = channels.find(a => a.id === pickedId) ?? channels[0] ?? null

  const [feeds, setFeeds] = useState<Record<string, FeedState>>({})
  const knownTiles = picked ? known?.[picked.id] : undefined
  const feed: FeedState | null = !picked ? null
    : feeds[picked.id] ?? (knownTiles ? { tiles: knownTiles, state: 'read' } : null)
  useEffect(() => {
    if (!picked || feeds[picked.id] || knownTiles) return
    const id = picked.id
    let alive = true
    setFeeds(f => ({ ...f, [id]: { tiles: [], state: 'reading' } }))
    void fetch(`/api/social/schedule/feed?account=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!alive) return
        const tiles = Array.isArray(j?.tiles) ? j.tiles as LiveTile[] : []
        setFeeds(f => ({ ...f, [id]: { tiles, state: j?.reason ? 'unreadable' : 'read' } }))
      })
      .catch(() => { if (alive) setFeeds(f => ({ ...f, [id]: { tiles: [], state: 'unreadable' } })) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.id, knownTiles])

  const tiles = useMemo(() => picked ? networkFeedPreview(post, others, picked.id, feed?.tiles ?? []) : [], [post, others, picked, feed])

  if (!channels.length) {
    return <p className="text-[13px] text-muted-foreground">Tick Instagram, Facebook, TikTok or LinkedIn and this post shows here among that account&rsquo;s posts.</p>
  }
  const network = String(picked!.platform)
  const liveCount = tiles.filter(t => t.kind === 'live').length
  const note = feedPreviewNote(network, liveCount, feed?.state ?? 'reading')
  const booked = tiles.filter(t => t.kind === 'booked').length

  return (
    <div className="flex flex-col gap-3" data-feed-preview>
      <div role="tablist" aria-label="Which network" className="flex flex-wrap gap-1.5">
        {channels.map(a => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === picked!.id} data-feed-network={a.platform}
            onClick={() => setPickedId(a.id)}
            className={cn('flex min-h-10 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold',
              a.id === picked!.id ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted')}>
            <PlatformIcon platform={a.platform} size={16} />
            {a.username ? (a.platform === 'linkedin' || a.platform === 'facebook' ? a.username : `@${a.username}`) : a.name ?? networkName(a.platform)}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        This post is outlined{booked ? `, among ${booked} other booked ${booked === 1 ? 'post' : 'posts'}` : ''}, latest first, above what is live on {networkName(network)} now.
      </p>
      {network === 'instagram' || network === 'tiktok'
        ? <FeedGrid tiles={tiles} tall={network === 'tiktok'} media={media} />
        : <FeedCards tiles={tiles} media={media} />}
      {note && <p className="text-[12px] text-muted-foreground" data-feed-note>{note}</p>}
    </div>
  )
}

const when = (t: FeedPreviewTile) => (t.at ? formatInZone(t.at, MELBOURNE, 'full') : null)
const badge = (t: FeedPreviewTile) =>
  t.kind === 'this' ? `This post${when(t) ? ` · ${when(t)}` : ' · no time yet'}`
    : t.kind === 'booked' ? `Booked · ${when(t) ?? 'no time yet'}` : null

function Cover({ t, media, className }: { t: FeedPreviewTile; media: (tile: { url: string; type: 'image' | 'video' }, label: string) => ReactNode; className: string }) {
  if (!t.cover) return <div className={cn(className, 'grid place-items-center bg-foreground/[0.06] text-[11px] text-muted-foreground')}>No picture</div>
  if (t.kind !== 'live') return <div className={className}>{media(t.cover, t.kind === 'this' ? 'This post' : '')}</div>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={t.cover.url} alt="" loading="lazy" className={cn(className, 'object-cover')} />
}

function FeedGrid({ tiles, tall, media }: { tiles: FeedPreviewTile[]; tall: boolean; media: (tile: { url: string; type: 'image' | 'video' }, label: string) => ReactNode }) {
  return (
    // BIG ENOUGH TO READ (the owner, 2 Nov 2026: 'make sure feed preview is big enough … the time in the badge is cut off'):
    // the grid takes the tab's width, and the badge wraps onto two lines instead of being cut
    <ul className={cn('grid w-full grid-cols-3 gap-1', tall ? 'max-w-[640px]' : 'max-w-[760px]')}>
      {tiles.map((t, i) => {
        const inner = (
          <>
            <Cover t={t} media={media} className="h-full w-full" />
            {badge(t) && (
              <span className={cn('absolute bottom-1.5 left-1.5 right-1.5 rounded-lg px-2 py-1 text-center text-[11px] font-semibold leading-tight',
                t.kind === 'this' ? 'bg-foreground text-background' : 'bg-ink/80 text-cream')}>{badge(t)}</span>
            )}
          </>
        )
        return (
          <li key={`${t.kind}-${t.id}-${i}`} data-feed-kind={t.kind} title={t.caption.slice(0, 200) || undefined}
            className={cn('relative overflow-hidden bg-foreground/[0.06]', tall ? 'aspect-[9/16]' : 'aspect-[4/5]',
              t.kind === 'this' && 'ring-2 ring-foreground ring-offset-1 ring-offset-background')}>
            {t.kind === 'live' && t.permalink
              ? <a href={t.permalink} target="_blank" rel="noopener noreferrer" className="block h-full w-full">{inner}</a>
              : inner}
          </li>
        )
      })}
    </ul>
  )
}

function FeedCards({ tiles, media }: { tiles: FeedPreviewTile[]; media: (tile: { url: string; type: 'image' | 'video' }, label: string) => ReactNode }) {
  return (
    <ul className="flex max-w-[460px] flex-col gap-2.5">
      {tiles.map((t, i) => (
        <li key={`${t.kind}-${t.id}-${i}`} data-feed-kind={t.kind}
          className={cn('overflow-hidden rounded-inner border bg-card', t.kind === 'this' ? 'border-foreground ring-2 ring-foreground' : 'border-border')}>
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
            {badge(t)
              ? <span className={cn('rounded-full px-2 py-0.5 font-semibold', t.kind === 'this' ? 'bg-foreground text-background' : 'bg-ink/80 text-cream')}>{badge(t)}</span>
              : <span className="text-muted-foreground">Posted{when(t) ? ` · ${when(t)}` : ''}</span>}
            {t.kind === 'live' && t.permalink && (
              <a href={t.permalink} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">Open</a>
            )}
          </div>
          {t.caption && <p className="line-clamp-3 overflow-hidden whitespace-pre-line break-words px-3 pb-2 text-[13px]">{t.caption}</p>}
          {/* a plain picture or video still, held inside its own box — the window's media player spilled over the next
              card and the caption (the owner's screenshot, 2 Nov 2026: 'looks broken') */}
          {t.cover && (
            <div className="relative aspect-[4/5] max-h-[360px] w-full overflow-hidden bg-foreground/[0.06]">
              {t.cover.type === 'video'
                ? <video src={`${t.cover.url}#t=0.1`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={t.cover.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
