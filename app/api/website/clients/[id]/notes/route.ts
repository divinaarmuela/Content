import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'

/**
 * Notes on a client, each stamped with who wrote it and when.
 *
 * The author is taken from the session, never from the request body — a client
 * record where anyone can post a note under someone else's name is worse than
 * no attribution at all. The name is denormalised alongside the id so a note
 * still reads correctly after its author leaves.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('account_manager')
    const { id } = await params
    const { data, error } = await supabase
      .from('client_notes')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireRole('account_manager')
    const { id } = await params
    const body = await req.json()
    const text = String(body.body ?? '').trim()
    if (!text) return NextResponse.json({ error: 'A note cannot be empty' }, { status: 400 })

    const { data, error } = await supabase
      .from('client_notes')
      .insert({
        client_id: id,
        body: text,
        author_id: me.id,
        author_name: me.name || me.email,
      })
      .select()
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(req: Request) {
  try {
    await requireRole('account_manager')
    const noteId = new URL(req.url).searchParams.get('noteId')
    if (!noteId) return NextResponse.json({ error: 'noteId is required' }, { status: 400 })

    const { error } = await supabase.from('client_notes').delete().eq('id', noteId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
