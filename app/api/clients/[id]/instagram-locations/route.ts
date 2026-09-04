import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { guard } from '@/app/lib/authz'
import { isPageId } from '@/app/lib/publish-core'
import { readLocations } from '@/app/lib/schedule-compose-core'

/**
 * The places a client tags Instagram posts at — added and removed one at a
 * time.
 *
 * ONE PLACE, NOT THE WHOLE LIST. The obvious shape for this — the browser
 * sends the array it is holding — is a read-modify-write: two managers with
 * the client's Social page open, one adds a venue, the other removes an old
 * one, and whoever saves second silently erases the other's edit. So the
 * request carries the OPERATION, and the operation is applied inside a claim
 * against whatever is actually stored (CLAUDE.md trap 11).
 *
 * POST   { name, pageId }  add one
 * DELETE ?pageId=…         remove one
 */

const LIMIT = 50

/** Apply `change` to the stored list, under a claim. */
async function edit(
  id: string,
  change: (current: { name: string; pageId: string }[]) =>
    { name: string; pageId: string }[] | { error: string },
): Promise<NextResponse> {
  let refusal: string | null = null
  const done = await table<Client>('clients').claim(id, cur => {
    if (!cur) return null
    const next = change(readLocations((cur as { instagram_locations?: unknown }).instagram_locations))
    if ('error' in next) { refusal = next.error; return null }
    return { ...cur, instagram_locations: next } as Client
  })
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })
  if (!done.claimed) {
    return done.current
      // the claim ran out of attempts rather than deciding against us
      ? NextResponse.json(
        { error: 'Somebody else was editing this list at the same time. Try again.' },
        { status: 409 })
      : NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  return NextResponse.json({
    instagram_locations: readLocations(
      (done.row as { instagram_locations?: unknown }).instagram_locations),
  })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    const denied = await guard('scheduler')
    if (denied) return denied
    const { id } = await params
    const row = await table<Client>('clients').get(id)
    if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    return NextResponse.json({
      instagram_locations: readLocations((row as { instagram_locations?: unknown }).instagram_locations),
    })
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    const denied = await guard('account_manager')
    if (denied) return denied
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const name = String(body.name ?? '').trim().slice(0, 80)
    const pageId = String(body.pageId ?? '').trim()

    if (!name) {
      return NextResponse.json(
        { error: 'Give the place a name your team will recognise' }, { status: 400 })
    }
    // the mistake everybody makes is the @name, and Instagram answers it by
    // refusing the post hours later with nobody watching
    if (!isPageId(pageId)) {
      return NextResponse.json(
        { error: 'That does not look like a Page ID — it is a long number, not the @name' },
        { status: 400 })
    }

    return edit(id, current => {
      if (current.some(l => l.pageId === pageId)) return { error: 'That place is already on the list' }
      if (current.length >= LIMIT) {
        return { error: `That is as many places as one client can keep (${LIMIT}).` }
      }
      return [...current, { name, pageId }]
    })
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    const denied = await guard('account_manager')
    if (denied) return denied
    const { id } = await params
    const pageId = new URL(req.url).searchParams.get('pageId') ?? ''
    if (!pageId) return NextResponse.json({ error: 'Which place?' }, { status: 400 })
    // removing one that is already gone is what the caller wanted, not an error
    return edit(id, current => current.filter(l => l.pageId !== pageId))
  })
}
