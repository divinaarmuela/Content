import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Client, ScheduleEntry } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds, heldItemIds } from '../../../lib/production-access'

/**
 * Everything with a scheduled time, for the calendar.
 *
 * Scoped the same way the item list is: a client sees only their own, a
 * scheduler sees their assigned clients. The calendar is a different view of
 * the same data as the queue, not a separate source of truth.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    const entries = await table<ScheduleEntry>('schedule_entries').list({
      where: r => {
        // an entry with no time is not on the calendar window at all — the
        // same rows a Postgres gte/lte comparison dropped
        if (from && !(r.scheduled_at != null && r.scheduled_at >= from)) return false
        if (to && !(r.scheduled_at != null && r.scheduled_at <= to)) return false
        return true
      },
      orderBy: [['scheduled_at', 'asc']],
      limit: 500,
    })
    const withItem = await attachOne(entries, 'item_id', 'content_items',
      ['id', 'title', 'status', 'content_type', 'client_id'])
    // the client's name and zone hang off the ITEM, one level below what a
    // single attach reaches — the calendar prints both against every slot
    const clientById = new Map((await table<Client>('clients').list()).map(c => [c.id, c]))
    const joined = withItem.map(r => {
      const item = r.content_items as { id?: string; client_id?: string } | null
      const client = item?.client_id ? clientById.get(item.client_id) ?? null : null
      return {
        ...r,
        content_items: item
          ? { ...item, clients: client ? { name: client.name, timezone: client.timezone } : null }
          : null,
      }
    })

    // scope after the join: the client id lives on the item, not the entry.
    // Assignment counts here too — a piece handed to someone off the client
    // team has a slot on the calendar, and the person who has to post it was
    // the one person who could not see when it goes out.
    const allowed = await accessibleClientIds(user)
    const held = allowed === null ? new Set<string>() : new Set(await heldItemIds(user))
    const rows = joined.filter(r => {
      if (allowed === null) return true
      const item = r.content_items as { id?: string; client_id?: string } | null
      if (item?.id && held.has(item.id)) return true
      return item?.client_id ? allowed.includes(item.client_id) : false
    })

    return NextResponse.json(rows)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
