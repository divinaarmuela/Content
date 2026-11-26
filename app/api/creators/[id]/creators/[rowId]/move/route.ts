import { moveCreator } from '../../../../../../lib/creator-campaigns'
import type { CreatorStage } from '../../../../../../lib/creator-campaign-core'
import { answer, asTeam, bodyOf } from '../../../../respond'

/** POST { to, expect_rev, note? } — the team moves a creator to another stage. The rule is `stageMove` in the core. */
export const dynamic = 'force-dynamic'

export function POST(req: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  return asTeam(async v => {
    const { id, rowId } = await params
    const body = await bodyOf(req)
    return answer(await moveCreator({ kind: 'team', viewer: v }, id, rowId, String(body.to) as CreatorStage, Number(body.expect_rev), typeof body.note === 'string' ? body.note : null), 'creator')
  })
}
