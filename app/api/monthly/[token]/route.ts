import { NextResponse } from 'next/server'
import { getMonthlyByToken, saveMonthlyAnswers } from '../../../lib/monthly'
import { completion } from '../../../lib/intake-core'
import { announceAfter } from '@/lib/live'

/**
 * Public monthly-update form, resolved by token alone.
 *
 * The token IS the credential — there is no session here. So this route reads
 * and writes exactly ONE form, the one the token resolves to, and never accepts
 * a client id or form id from the request. Mirrors the intake public route.
 */

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getMonthlyByToken(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    definition: form.definition,
    answers: form.answers,
    status: form.status,
    completion: completion(form.definition, form.answers),
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

  const saved = await saveMonthlyAnswers(token, patch)
  if (!saved) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Announce progress so an open dashboard panel updates as the client types.
  // Fire and forget: the answer is already saved, and a publish failure must
  // never turn a successful autosave into an error the client sees.
  const form = await getMonthlyByToken(token)
  if (form) {
    const c = completion(form.definition, saved.answers)
    announceAfter('monthly', {
      form_id: form.id,
      client_id: form.client_id,
      status: saved.status,
      answered: c.answered,
      total: c.total,
    })
  }

  return NextResponse.json(saved)
}
