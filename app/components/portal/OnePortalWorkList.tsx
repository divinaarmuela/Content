import Link from 'next/link'
import type { PortalCard } from '../../lib/portal-data'
import { onePortalPath } from '../../lib/one-portal-core'
import { waitsOnClient } from '../../lib/one-portal-page'

/**
 * EDITING / DESIGNING — every piece that has reached the client, newest work waiting on them first. One tile per
 * piece: its picture, its title, where it stands, and one button that opens it inside the one page
 * (`?tab=…&id=`), where today's review (versions, comments, approve, ask for a change) is drawn.
 */
export default function OnePortalWorkList({ token, tab, cards, empty }: {
  token: string
  tab: 'editing' | 'designing'
  cards: PortalCard[]
  empty: string
}) {
  if (cards.length === 0) {
    return <p className="rounded-inner border border-dashed border-border px-4 py-10 text-center text-[14px] text-muted-foreground">{empty}</p>
  }
  const ordered = [...cards.filter(waitsOnClient), ...cards.filter(c => !waitsOnClient(c))]
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-one-portal-work={tab}>
      {ordered.map(card => {
        const waiting = waitsOnClient(card)
        const cover = card.preview_url ?? card.slides?.find(s => s.type === 'image')?.url ?? null
        const count = card.clips && card.clip_words ? `${card.clips} ${card.clips === 1 ? card.clip_words.one : card.clip_words.many}` : null
        return (
          <Link key={card.id} href={onePortalPath(token, tab, card.id)}
            className="group flex flex-col overflow-hidden rounded-card border border-border bg-card transition-colors hover:border-foreground/40"
            data-one-portal-tile={card.id}>
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
              {cover && (/\.(mp4|webm|mov)(\?|$)/i.test(cover)
                ? <video src={cover} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={cover} alt="" className="h-full w-full object-cover" />)}
              {waiting && (
                <span className="absolute left-3 top-3 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background">Needs your review</span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1 p-4">
              <p className="text-[15px] font-semibold leading-snug">{card.title}</p>
              {card.line && <p className="text-[13px] text-muted-foreground">{card.line}</p>}
              {count && <p className="text-[12px] text-muted-foreground" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>{count}</p>}
              <span className={`mt-3 inline-flex min-h-10 w-fit items-center rounded-full px-4 text-[13px] font-semibold ${
                waiting ? 'bg-foreground text-background' : 'border border-border'
              }`}>
                {waiting ? 'Review' : 'Open'}
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
