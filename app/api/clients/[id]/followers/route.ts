import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { assertClientAccess } from '../../../../lib/social-schedule'
import { followersEnabled } from '../../../../lib/follower-source'
import {
  DAILY_TOP_MAX, DAILY_TOP_MIN, isFullCadence, settingsOf,
} from '../../../../lib/followers-core'

/**
 * A client's three "who follows" choices.
 *
 *   on_portal     — does the client see their followers on the portal (off
 *                   by default; a client's list is theirs to be shown, not
 *                   pushed)
 *   daily_top     — how many of the newest followers the morning look reads
 *   full_cadence  — how often the whole list is read: weekly | monthly | off
 *
 * GET  → { enabled, on_portal, daily_top, full_cadence }   any team member on the client
 * PUT  → any subset of the three                            an account manager or a super admin
 *
 * The write is a claim on the client row (CLAUDE.md trap 11): the row
 * carries far more than these three fields, and two managers on the same
 * page must not write over each other.
 */

const shape = (row: Client) => {
  const s = settingsOf(row)
  return { enabled: followersEnabled(), on_portal: s.onPortal, daily_top: s.dailyTop, full_cadence: s.fullCadence }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      await assertClientAccess(user, id)
      const row = await table<Client>('clients').get(id)
      if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      return NextResponse.json(shape(row))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const { id } = await params
      await assertClientAccess(user, id)
      const body = await req.json().catch(() => ({})) as Record<string, unknown>

      const patch: Partial<Client> = {}
      if ('on_portal' in body) {
        if (typeof body.on_portal !== 'boolean') return NextResponse.json({ error: 'Say whether the portal shows followers' }, { status: 400 })
        patch.followers_on_portal = body.on_portal
      }
      if ('daily_top' in body) {
        const n = Number(body.daily_top)
        if (!Number.isFinite(n) || n < DAILY_TOP_MIN || n > DAILY_TOP_MAX) {
          return NextResponse.json({ error: `Pick a number between ${DAILY_TOP_MIN} and ${DAILY_TOP_MAX}` }, { status: 400 })
        }
        patch.followers_daily_top = Math.round(n)
      }
      if ('full_cadence' in body) {
        if (!isFullCadence(body.full_cadence)) return NextResponse.json({ error: 'Pick weekly, monthly or off' }, { status: 400 })
        patch.followers_full_cadence = body.full_cadence
      }
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

      const done = await table<Client>('clients').claim(id, cur => cur ? ({ ...cur, ...patch } as Client) : null)
      if (!done.claimed) {
        return done.current
          ? NextResponse.json({ error: 'Somebody else was changing this client at the same time. Try again.' }, { status: 409 })
          : NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
      return NextResponse.json(shape(done.row))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
