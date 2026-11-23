'use client'

import BriefCanvas from '../../dashboard/production/shoots/[id]/BriefCanvas'
import type { CanvasCard, ReferenceMedia } from '../../lib/batch-brief-core'

/**
 * THE PLANNING BOARD ON THE TEAM LINK: the same canvas the team draws on, read only. `canEdit` is false and every
 * change is refused, so nothing a visitor does here can reach the shoot.
 */
export default function SharedBoard({ cards, references, clientName }: { cards: CanvasCard[]; references: ReferenceMedia[]; clientName?: string }) {
  return <BriefCanvas cards={cards} references={references} canEdit={false} clientName={clientName} onOp={async () => false} />
}
