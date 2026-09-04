import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { requireRole } from '@/app/lib/authz'
import { safeZone } from '@/app/lib/timezone-core'
import { suggestedTimes, type AnalyticsRow } from '@/app/lib/social-schedule-core'
import {
  analyticsForClient, assertClientAccess, scheduleErrorResponse,
} from '@/app/lib/social-schedule'

/**
 * GET ?clientId=…&network=… — good times to post, from THIS client's own
 * numbers where they have enough of them and the starting list until then.
 * The sentence explaining which is on every slot.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const url = new URL(req.url)
      const clientId = url.searchParams.get('clientId')
      if (!clientId) return NextResponse.json({ error: 'Pick a client first' }, { status: 400 })
      await assertClientAccess(user, clientId)
      const client = await table<Client>('clients').get(clientId).catch(() => null)
      const tz = safeZone(url.searchParams.get('tz') ?? (client?.timezone as string | null))
      const times = suggestedTimes({
        analytics: await analyticsForClient(clientId) as AnalyticsRow[],
        network: url.searchParams.get('network') ?? 'instagram',
        tz,
        now: new Date().toISOString(),
      })
      return NextResponse.json({ times, timezone: tz })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
