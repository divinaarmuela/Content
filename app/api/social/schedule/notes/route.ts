import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ScheduleNote } from '@/lib/db-types'
import { requireRole } from '@/app/lib/authz'
import {
  addNote, assertClientAccess, listNotes, removeNote, scheduleErrorResponse,
} from '@/app/lib/social-schedule'

/** Notes pinned to a day and time on the calendar. Team-only: a note never
 *  reaches a client or a channel. */

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const url = new URL(req.url)
      const clientId = url.searchParams.get('clientId')
      if (!clientId) return NextResponse.json({ error: 'Pick a client first' }, { status: 400 })
      await assertClientAccess(user, clientId)
      return NextResponse.json({
        notes: await listNotes(clientId, url.searchParams.get('from'), url.searchParams.get('to')),
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({}))
      const clientId = String(body.client_id ?? '')
      if (!clientId) return NextResponse.json({ error: 'Pick a client first' }, { status: 400 })
      await assertClientAccess(user, clientId)
      const note = await addNote(user, {
        client_id: clientId,
        at: String(body.at ?? new Date().toISOString()),
        text: String(body.text ?? ''),
      })
      return NextResponse.json({ note })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}

export async function DELETE(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const id = new URL(req.url).searchParams.get('id') ?? ''
      const note = await table<ScheduleNote>('schedule_notes').get(id)
      if (!note) return NextResponse.json({ error: 'That note is already gone' }, { status: 404 })
      await assertClientAccess(user, note.client_id)
      await removeNote(user, id)
      return NextResponse.json({ ok: true })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
