import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { portalOwnerByToken } from '../../../lib/portal-owner'
import { notifyManagersOfComment, portalActor } from '../../../lib/portal-actor'
import { campaignForClient, moveCreator } from '../../../lib/creator-campaigns'
import { isCreatorStage } from '../../../lib/creator-campaign-core'

/**
 * THE CLIENT'S ANSWER ON A CREATOR (the owner, 25 Nov 2026). POST { token, campaign_id, row_id, to, expect_rev, note? }.
 * The portal token says which client is speaking; a campaign that is not theirs is not there (404, nothing about it
 * comes back). What they may do is the core's: yes or no on a creator put in front of them, a no changed to a yes,
 * and only while the list is open. The campaign's team is told — never the creator, whom the app never contacts.
 */
export const dynamic = 'force-dynamic'

const WORDS: Record<string, string> = { approved: 'said yes to', passed: 'passed on' }

/** What goes back to the client's browser about a creator: where they stand, never the rate or who on the team decided. */
type Slim = { id: string; name: string; stage: string; client_note: string | null; rev: number }
const slim = (r: Partial<Slim>): Slim => ({ id: String(r.id ?? ''), name: String(r.name ?? ''), stage: String(r.stage ?? ''), client_note: r.client_note ?? null, rev: Number(r.rev ?? 0) })

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      const owner = await portalOwnerByToken(String(body.token ?? ''))
      if (!owner) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
      const campaignId = String(body.campaign_id ?? '')
      const rowId = String(body.row_id ?? '')
      const to = String(body.to ?? '')
      if (!campaignId || !rowId || !isCreatorStage(to)) return NextResponse.json({ error: 'Reload the page and try again' }, { status: 400 })

      const actor = await portalActor(owner.client.id, owner.client.name)
      const note = typeof body.note === 'string' ? body.note : null
      const res = await moveCreator({ kind: 'client', clientId: owner.client.id, actorId: actor.id }, campaignId, rowId, to, Number(body.expect_rev), note)
      if (!res.ok) return NextResponse.json({ error: res.reason, ...(res.fresh ? { fresh: slim(res.fresh as Partial<Slim>) } : {}) }, { status: res.status })

      // the team hears it; a mail that does not send must not undo an answer that was saved
      try {
        const found = await campaignForClient(owner.client.id, campaignId)
        if (found) {
          await notifyManagersOfComment({
            clientId: owner.client.id,
            speaker: owner.contact?.name ?? owner.client.name,
            subjectTitle: found.campaign.title,
            body: `${owner.contact?.name ?? owner.client.name} ${WORDS[to] ?? to} ${res.value.name}.${res.value.client_note ? ` “${res.value.client_note}”` : ''}`,
            dashboardPath: `/dashboard/creators/${campaignId}`,
            alsoUserIds: [...found.campaign.member_ids, found.campaign.created_by],
          })
        }
      } catch (e) {
        console.error('[portal/creators] the team was not told', e)
      }
      return NextResponse.json({ creator: slim(res.value) })
    } catch (e) {
      console.error('[portal/creators]', e)
      return NextResponse.json({ error: 'That did not save. Try again.' }, { status: 500 })
    }
  })
}
