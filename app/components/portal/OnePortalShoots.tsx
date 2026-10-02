'use client'

import type { PortalData, PortalCard } from '../../lib/portal-data'
import { pickPortalTheme } from '../../lib/portal-theme'
import { PortalCardView } from './PortalBoard'
import ShootBoard from './ShootBoard'

/**
 * SHOOT BRIEF — the client's shoot plans, exactly as the portal draws them today (PortalSectionsView's shoot
 * section): the board leads when it is shared, the plan card under it with its PDF, Approve and Ask for a change,
 * and the comments. Nothing new is decided here; it is the same card on the one page.
 */
export default function OnePortalShoots({ token, data, shoots, initialCardId }: {
  token: string
  data: PortalData
  shoots: PortalCard[]
  initialCardId?: string | null
}) {
  const theme = pickPortalTheme(data.brand as Parameters<typeof pickPortalTheme>[0])
  const accent = theme.branded ? { background: theme.accent, color: theme.accentInk } : undefined
  const surface = { token }
  if (shoots.length === 0) {
    return <p className="rounded-inner border border-dashed border-border px-4 py-10 text-center text-[14px] text-muted-foreground">No shoot plans to look at yet. When your next shoot is planned, it shows here.</p>
  }
  return (
    <div className="flex flex-col gap-10" data-one-portal-shoots>
      {shoots.map(card => {
        const boardLive = card.shoot?.shared && card.shoot.canvas_cards.length > 0
        return (
          <div key={card.id} id={`shoot-${card.id}`} className="flex scroll-mt-28 flex-col gap-3">
            {boardLive && card.shoot && (
              <ShootBoard
                shootId={card.id}
                boardName={card.shoot.board_name}
                cards={card.shoot.canvas_cards}
                comments={card.comments}
                surface={surface}
                clientName={data.client.name}
                amName={data.am_name}
                initialCardId={initialCardId ?? null}
                fullHref={`/portal/${token}/shoot/${card.id}`}
              />
            )}
            <PortalCardView card={card} amName={data.am_name} accent={accent} surface={surface} className="max-w-3xl" />
          </div>
        )
      })}
    </div>
  )
}
