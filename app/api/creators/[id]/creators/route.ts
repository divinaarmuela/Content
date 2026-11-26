import { addCreator } from '../../../../lib/creator-campaigns'
import { answer, asTeam, bodyOf } from '../../respond'

/** POST: put a creator on the campaign as an idea — typed in, or picked from the agency's list with `creator_id`. */
export const dynamic = 'force-dynamic'

export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return asTeam(async v => answer(await addCreator(v, (await params).id, await bodyOf(req)), 'creator', 201))
}
