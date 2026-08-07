import { NextResponse } from 'next/server'
import { getIntakeByToken, saveIntakeAnswers, listIntakeFiles } from '../../../lib/intake'
import { completion } from '../../../lib/intake-core'

/**
 * Public intake form, resolved by token alone.
 *
 * The token IS the credential — there is no session here. So this route reads
 * and writes exactly ONE form, the one the token resolves to, and never accepts
 * a client id or form id from the request.
 */

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getIntakeByToken(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    definition: form.definition,
    answers: form.answers,
    status: form.status,
    completion: completion(form.definition, form.answers),
    files: await listIntakeFiles(form.id),
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let patch: unknown
  try {
    patch = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const saved = await saveIntakeAnswers(token, patch)
  if (!saved) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(saved)
}
