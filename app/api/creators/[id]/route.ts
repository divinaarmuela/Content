import { NextResponse } from 'next/server'
import { campaignPeople, deleteCampaign, loadCampaign, patchCampaign } from '../../../lib/creator-campaigns'
import { answer, asTeam, bodyOf } from '../respond'

/**
 * One campaign. GET: the campaign, its creators, the client's portal link and the team (for "who is on this") — 404
 * when it is not there OR not this person's; the two look the same. PATCH { expect_rev, …fields }. DELETE.
 */
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

export function GET(_req: Request, { params }: Ctx) {
  return asTeam(async v => {
    const { id } = await params
    const loaded = await loadCampaign(v, id)
    if (!loaded) return NextResponse.json({ error: 'That campaign is not here' }, { status: 404 })
    return NextResponse.json({ ...loaded, people: await campaignPeople() })
  })
}

export function PATCH(req: Request, { params }: Ctx) {
  return asTeam(async v => {
    const { id } = await params
    const body = await bodyOf(req)
    return answer(await patchCampaign(v, id, body, Number(body.expect_rev)), 'campaign')
  })
}

export function DELETE(_req: Request, { params }: Ctx) {
  return asTeam(async v => answer(await deleteCampaign(v, (await params).id), 'ok'))
}
