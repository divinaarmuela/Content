import { NextResponse } from 'next/server'
import { campaignClients, createCampaign, listCampaigns } from '../../lib/creator-campaigns'
import { answer, asTeam, bodyOf } from './respond'

/**
 * CREATOR CAMPAIGNS (the owner, 25 Nov 2026). GET: the campaigns this person may see (every one for a super admin;
 * their clients' and the ones they were added to for an account manager; only the ones they were added to for
 * anyone else), and the clients they may make one for. POST: make one — a draft, hidden from the client.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return asTeam(async (v, user) => {
    const [campaigns, clients] = await Promise.all([listCampaigns(v), campaignClients(v)])
    return NextResponse.json({ campaigns, clients, me: { id: user.id, name: user.name, role: user.role, mayCreate: clients.length > 0 } })
  })
}

export function POST(req: Request) {
  return asTeam(async v => answer(await createCampaign(v, await bodyOf(req)), 'campaign', 201))
}
