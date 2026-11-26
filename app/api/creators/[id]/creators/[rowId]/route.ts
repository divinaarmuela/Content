import { patchCreator, removeCreator } from '../../../../../lib/creator-campaigns'
import { answer, asTeam, bodyOf } from '../../../respond'

/** One creator on one campaign. PATCH { expect_rev, …fields } — never the stage. DELETE — only while still an idea. */
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string; rowId: string }> }

export function PATCH(req: Request, { params }: Ctx) {
  return asTeam(async v => {
    const { id, rowId } = await params
    const body = await bodyOf(req)
    return answer(await patchCreator(v, id, rowId, body, Number(body.expect_rev)), 'creator')
  })
}

export function DELETE(_req: Request, { params }: Ctx) {
  return asTeam(async v => {
    const { id, rowId } = await params
    return answer(await removeCreator(v, id, rowId), 'ok')
  })
}
