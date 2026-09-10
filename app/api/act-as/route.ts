import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { TeamUser as TeamUserRow } from '@/lib/db-types'
import { resolveRealTeamUser, authzErrorResponse, AuthzError } from '@/app/lib/authz'
import {
  ACT_AS_COOKIE, ACT_AS_MAX_AGE_SECONDS, mayActAs, readActAs,
} from '@/app/lib/act-as-core'

/**
 * "Act as this person" — the one endpoint that starts, reads and stops it.
 *
 * Every method here resolves the REAL signed-in row (never the acted-as one)
 * and asks `mayActAs` about that email. So while tech@ is acting as somebody,
 * they can still stop; and nobody else can start, list people, or discover
 * that any of this exists. Hiding the button in the shell is a courtesy — this
 * is the control.
 *
 * The cookie carries only a team_users id. It grants nothing on its own:
 * `resolveTeamUser` re-checks the real email on every request, so a copied
 * cookie in anybody else's browser does exactly nothing.
 */

export const dynamic = 'force-dynamic'

type Person = { id: string; name: string; email: string; role: string }

const person = (r: TeamUserRow): Person => ({
  id: r.id, name: r.name || r.email, email: r.email, role: r.role,
})

/** The real signed-in person, refused unless they are the one address. */
async function realOrRefuse() {
  const real = await resolveRealTeamUser()
  if (!mayActAs(real.email)) {
    throw new AuthzError('This account cannot act as other people', 403)
  }
  return real
}

/** Somebody it is allowed to become: on the team, active, not a client, not you. */
async function targetOrNull(id: string, realId: string): Promise<TeamUserRow | null> {
  if (id === realId) return null
  const row = await table<TeamUserRow>('team_users').get(id)
  if (!row || !row.active_status || row.role === 'client') return null
  return row
}

/** Who you are acting as right now, and everybody you could act as. */
export async function GET(req: Request) {
  try {
    const real = await realOrRefuse()

    const raw = readCookie(req, ACT_AS_COOKIE)
    const id = readActAs(raw)
    const current = id ? await targetOrNull(id, real.id) : null

    const people = (await table<TeamUserRow>('team_users').list({
      where: r => r.active_status === true && r.role !== 'client' && r.id !== real.id,
    })).map(person).sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({
      // the real person too, so the bar can name who is actually at the
      // keyboard without a second round trip
      real: { id: real.id, name: real.name || real.email, email: real.email },
      acting: current ? person(current) : null,
      people,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Start acting as somebody. */
export async function POST(req: Request) {
  try {
    const real = await realOrRefuse()
    const body = await req.json().catch(() => ({})) as { team_user_id?: unknown }
    const id = readActAs(typeof body.team_user_id === 'string' ? body.team_user_id : null)
    if (!id) return NextResponse.json({ error: 'Choose a person to act as' }, { status: 400 })

    const target = await targetOrNull(id, real.id)
    if (!target) {
      return NextResponse.json({ error: 'That is not somebody you can act as' }, { status: 400 })
    }

    const res = NextResponse.json({ acting: person(target) })
    res.cookies.set({
      name: ACT_AS_COOKIE,
      value: target.id,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: ACT_AS_MAX_AGE_SECONDS,
    })
    return res
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Stop acting as somebody and go back to being yourself. */
export async function DELETE() {
  try {
    await realOrRefuse()
    const res = NextResponse.json({ acting: null })
    res.cookies.set({
      name: ACT_AS_COOKIE,
      value: '',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    return res
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** One cookie out of the request header, without pulling in `next/headers`. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    try { return decodeURIComponent(part.slice(eq + 1).trim()) } catch { return null }
  }
  return null
}
