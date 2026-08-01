import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'

/** Posts that have comments, across every connected account. */
export async function GET() {
  try {
    await requireRole('editor')
    const publisher = getPublisher()
    if (!publisher.configured()) return NextResponse.json({ data: [], configured: false })

    const listed = await publisher.listComments() as { data?: unknown[] } | null
    return NextResponse.json({ data: listed?.data ?? [], configured: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
