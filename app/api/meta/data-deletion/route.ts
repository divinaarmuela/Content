import { NextRequest, NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { DataDeletionRequest } from '@/lib/db-types'
import { confirmationCodeFor, parseSignedRequest, statusUrl } from '@/app/lib/meta-signed-request-core'

/**
 * META'S DATA DELETION REQUEST CALLBACK (Meta App Review groundwork, 30 Sep 2026).
 * https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 *
 * PUBLIC and Clerk-free on purpose: Meta calls it, not a person. It is absent
 * from middleware.ts's protected list and its matcher, and must stay so.
 *
 * What it does, and all it does:
 *   1. verifies Meta's `signed_request` against META_APP_SECRET;
 *   2. RECORDS the request in `data_deletion_requests`, keyed by a confirmation
 *      code derived from the signed request, with a claim — a callback Meta
 *      delivers twice is one row, and nothing is ever overwritten;
 *   3. answers `{ url, confirmation_code }` as Meta requires.
 *
 * What it does NOT do: delete anything, or email anyone. The owner's rule is
 * no automatic emails to clients, and deletion is a super admin's job, done
 * by hand, with the row's `status` moved as it goes. Until the owner has a
 * Meta app and sets META_APP_SECRET the route answers 503 and records nothing.
 */

export const dynamic = 'force-dynamic'

async function readSignedRequest(req: NextRequest): Promise<unknown> {
  const type = req.headers.get('content-type') ?? ''
  try {
    if (type.includes('application/json')) {
      const body = await req.json()
      return body && typeof body === 'object' ? (body as Record<string, unknown>).signed_request : undefined
    }
    // Meta posts application/x-www-form-urlencoded; formData() reads multipart too
    const form = await req.formData()
    return form.get('signed_request') ?? undefined
  } catch {
    return undefined
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  const signedRequest = await readSignedRequest(req)
  const parsed = parseSignedRequest(signedRequest, secret)
  if (!parsed.ok) {
    const status = parsed.reason === 'bad_signature' ? 401 : 400
    return NextResponse.json({ error: parsed.reason }, { status })
  }

  const code = confirmationCodeFor(signedRequest as string)
  const now = new Date().toISOString()
  const result = await table<DataDeletionRequest>('data_deletion_requests').claim(code, current =>
    // already recorded (Meta redelivered): stand down, the first row stands
    current ? null : {
      id: code,
      meta_user_id: parsed.payload.user_id,
      received_at: now,
      status: 'received',
      note: null,
      updated_at: now,
    },
  )
  // claimed, or already there — either way the request is on record under this code
  if (!result.claimed && !result.current) {
    return NextResponse.json({ error: 'could not record the request, please retry' }, { status: 503 })
  }

  return NextResponse.json({ url: statusUrl(code), confirmation_code: code })
}
