'use client'

import type { PortalData } from '../../lib/portal-data'
import { heroCounts, portalSections, type PortalSectionKey } from '../../lib/portal-core'
import { pickPortalTheme } from '../../lib/portal-theme'
import { PortalCardView, type Surface } from './PortalBoard'
import ShootBoard from './ShootBoard'
import { SectionHeading } from './PortalSections'

/**
 * THE PORTAL, TOP TO BOTTOM — the layout the owner asked back for.
 *
 * Sections in the order a client cares: what needs THEM, then their shoots
 * (each with its planning board open underneath), then what the team is
 * making, what is approved and booked, and what is live. The cards inside
 * are today's cards — one line, the link, one tap to approve, "Ask for a
 * change" as the quiet second, the comments pinned to each. No quotas.
 *
 * Shared by the share-link page (server-rendered, refreshed live) and the
 * signed-in client page (fetched, reloaded live). Both hand it the same
 * payload and their own surface.
 */
export default function PortalSectionsView({ data, surface, initialCardId }: {
  data: PortalData
  surface: Surface
  /** open a shoot board on this card's thread (from a link in an email) */
  initialCardId?: string | null
}) {
  const token = 'token' in surface ? surface.token : null
  const theme = pickPortalTheme(data.brand as Parameters<typeof pickPortalTheme>[0])
  const accent = theme.branded ? { background: theme.accent, color: theme.accentInk } : undefined
  const work = data.cards.filter(c => c.kind === 'work')
  const shoots = data.cards.filter(c => c.kind === 'shoot')
  const sections = portalSections(work)
  const counts = heroCounts(data.cards)
  const plansWaiting = shoots.filter(c => c.actions.approve)
  const posted = data.published_totals?.posts ?? 0

  const grid = (key: PortalSectionKey) => {
    const s = sections.find(x => x.key === key)!
    return (
      <section key={key} className="flex flex-col gap-4" data-portal-section={key}>
        <SectionHeading count={counts[key]}>{s.title.toUpperCase()}</SectionHeading>
        {key === 'published' && posted > 0 && (
          <p className="text-[13px] text-muted-foreground">{posted === 1 ? '1 post' : `${posted} posts`} this month.</p>
        )}
        {key === 'review' && plansWaiting.length > 0 && (
          <p className="text-[14px]">
            {plansWaiting.length === 1 ? 'A shoot plan is' : `${plansWaiting.length} shoot plans are`} waiting on you too —{' '}
            <a href={`#shoot-${plansWaiting[0].id}`} className="font-semibold underline underline-offset-4">it’s just below</a>.
          </p>
        )}
        {s.cards.length === 0 ? (
          plansWaiting.length > 0 && key === 'review' ? null : (
            <p className="rounded-inner border border-dashed border-border px-4 py-6 text-center text-[14px] text-muted-foreground">{s.empty}</p>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {s.cards.map(card => (
              <PortalCardView key={`${card.kind}-${card.id}`} card={card} amName={data.am_name} accent={accent} surface={surface} />
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      {grid('review')}

      {shoots.length > 0 && (
        <section className="flex flex-col gap-6" data-portal-section="shoots">
          <SectionHeading count={shoots.length}>{shoots.length === 1 ? 'YOUR SHOOT' : 'YOUR SHOOTS'}</SectionHeading>
          {shoots.map(card => (
            <div key={card.id} id={`shoot-${card.id}`} className="flex scroll-mt-16 flex-col gap-3">
              <PortalCardView card={card} amName={data.am_name} accent={accent} surface={surface} className="max-w-3xl" />
              {/* the planning board, open, by the owner's rule — the same
                  canvas the team draws on, read-only, with its comments */}
              {card.shoot?.shared && card.shoot.canvas_cards.length > 0 && (
                <ShootBoard
                  shootId={card.id}
                  boardName={card.shoot.board_name}
                  cards={card.shoot.canvas_cards}
                  comments={card.comments}
                  surface={surface}
                  clientName={data.client.name}
                  amName={data.am_name}
                  initialCardId={initialCardId ?? null}
                  fullHref={token ? `/portal/${token}/shoot/${card.id}` : null}
                />
              )}
            </div>
          ))}
        </section>
      )}

      {grid('production')}
      {grid('approved')}
      {grid('published')}
    </div>
  )
}
