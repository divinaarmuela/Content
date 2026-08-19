import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'

/** One automation, with its stats and recent trigger log. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('scheduler')
    const { id } = await params
    const publisher = getPublisher()
    const [automation, logs] = await Promise.all([
      publisher.getAutomation(id),
      publisher.automationLogs(id),
    ])
    return NextResponse.json({ automation, logs })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Pause/resume or edit. Only known-safe fields pass through. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('scheduler')
    const { id } = await params
    const body = await req.json()

    const patch: Record<string, unknown> = {}
    if (typeof body.isActive === 'boolean') patch.isActive = body.isActive
    if (typeof body.dmMessage === 'string' && body.dmMessage.trim()) patch.dmMessage = body.dmMessage.trim()
    if (Array.isArray(body.keywords)) {
      const keywords = body.keywords.map((k: unknown) => String(k ?? '').trim()).filter(Boolean)
      if (keywords.length > 0) patch.keywords = keywords
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    }

    return NextResponse.json({ updated: await getPublisher().updateAutomation(id, patch) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Delete permanently, logs included — the UI confirms before calling. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('scheduler')
    const { id } = await params
    return NextResponse.json({ deleted: await getPublisher().deleteAutomation(id) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
