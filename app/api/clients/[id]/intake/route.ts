import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse, roleSatisfies } from '../../../../lib/authz'
import {
  createIntakeForm, getIntakeForClient, reopenIntake,
  rotateIntakeToken, markIntakeSent, listIntakeFiles,
} from '../../../../lib/intake'
import { completion, type TemplateKey } from '../../../../lib/intake-core'

/**
 * The intake form for one client.
 *
 * Reading is editor+, so anyone who can see the client can read what they
 * said. Creating, rotating and reopening are super_admin only — consistent
 * with every other client-scoped write, and enforced here rather than by the
 * UI hiding buttons.
 *
 * GET returns `can_manage` so the panel knows which controls to render. The
 * dashboard has no client-side notion of role, and inventing one would create
 * a second source of truth for something the server already knows.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const canManage = roleSatisfies(user.role, 'super_admin')

    const form = await getIntakeForClient(id)
    if (!form) return NextResponse.json({ form: null, can_manage: canManage })

    return NextResponse.json({
      can_manage: canManage,
      form: {
        id: form.id,
        token: form.token,
        status: form.status,
        template_key: form.template_key,
        sent_at: form.sent_at,
        first_opened_at: form.first_opened_at,
        submitted_at: form.submitted_at,
      },
      definition: form.definition,
      answers: form.answers,
      completion: completion(form.definition, form.answers),
      files: await listIntakeFiles(form.id),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole('super_admin')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const key = (body?.template_key ?? 'one_off') as TemplateKey

    const form = await createIntakeForm(id, key, admin.id)
    return NextResponse.json({ id: form.id, token: form.token, status: form.status }, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    // the unique index on client_id is the real guard against a second form;
    // this only translates it into something a person can read
    if (/duplicate key|already exists/i.test(error)) {
      return NextResponse.json({ error: 'This client already has an intake form' }, { status: 409 })
    }
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const form = await getIntakeForClient(id)
    if (!form) return NextResponse.json({ error: 'No intake form for this client' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    switch (body?.action) {
      case 'reopen':
        await reopenIntake(form.id)
        return NextResponse.json({ ok: true })
      case 'rotate':
        return NextResponse.json({ token: await rotateIntakeToken(form.id) })
      case 'mark_sent':
        await markIntakeSent(form.id)
        return NextResponse.json({ ok: true })
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
