import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { getInstructions, saveInstructions } from '../../../lib/assistant-chats'
import { MAX_INSTRUCTIONS, isValidTimezone } from '../../../lib/assistant-core'

/**
 * Assistant behaviour: strictly self-service. You read and write your own
 * standing instructions and timezone, nobody else's — the target is always
 * the signed-in user, never a parameter.
 */

export async function GET() {
  try {
    const user = await requireRole('editor')
    const instructions = await getInstructions(user.clerk_user_id ?? user.email)
    return NextResponse.json({
      instructions,
      timezone: user.timezone,
      max_length: MAX_INSTRUCTIONS,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireRole('editor')
    const body = await req.json().catch(() => ({}))

    const saved = await saveInstructions(
      user.clerk_user_id ?? user.email, user.email, body?.instructions, user.email,
    )

    let timezone = user.timezone
    if (typeof body?.timezone === 'string' && body.timezone !== user.timezone) {
      if (!isValidTimezone(body.timezone)) {
        return NextResponse.json({ error: 'That is not a valid timezone' }, { status: 400 })
      }
      const { error } = await supabase.from('team_users')
        .update({ timezone: body.timezone }).eq('id', user.id)
      if (error) throw new Error(error.message)
      timezone = body.timezone
    }

    return NextResponse.json({ instructions: saved, timezone })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
