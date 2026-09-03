import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ClientNote } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { explainDbError } from '@/app/lib/db-errors'

/**
 * Notes on a client, each stamped with who wrote it and when.
 *
 * The author is taken from the session, never from the request body — a client
 * record where anyone can post a note under someone else's name is worse than
 * no attribution at all. The name is denormalised alongside the id so a note
 * still reads correctly after its author leaves.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const me = await requireRole('account_manager')
    const { id } = await params
    let data: ClientNote[]
    try {
      data = await table<ClientNote>('client_notes').list({
        by: { client_id: id }, orderBy: [['created_at', 'desc']],
      })
    } catch (e) {
      throw new Error(explainDbError((e as Error).message, 'client_records.sql'))
    }

    // Filtered HERE, not in the UI. A note marked private or admins-only that
    // still travels to the browser is visible to anyone who opens devtools —
    // which is the whole thing the toggle is supposed to prevent.
    const visible = data.filter(n => {
      if (n.visibility === 'private') return n.author_id === me.id
      if (n.visibility === 'admins') return me.role === 'super_admin'
      return true
    })
    return NextResponse.json(visible)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const me = await requireRole('account_manager')
    const { id } = await params
    const body = await req.json()
    const text = String(body.body ?? '').trim()
    if (!text) return NextResponse.json({ error: 'A note cannot be empty' }, { status: 400 })

    const visibility = ['team', 'admins', 'private'].includes(body.visibility)
      ? body.visibility
      : 'team'

    let data
    try {
      data = await table('client_notes').insert({
        client_id: id,
        body: text,
        visibility,
        author_id: me.id,
        author_name: me.name || me.email,
      })
    } catch (e) {
      throw new Error(explainDbError((e as Error).message, 'client_records.sql'))
    }
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function DELETE(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('account_manager')
    const noteId = new URL(req.url).searchParams.get('noteId')
    if (!noteId) return NextResponse.json({ error: 'noteId is required' }, { status: 400 })

    try {
      await table<ClientNote>('client_notes').remove(noteId)
    } catch (e) {
      throw new Error(explainDbError((e as Error).message, 'client_records.sql'))
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
