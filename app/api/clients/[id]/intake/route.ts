import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse, roleSatisfies } from '../../../../lib/authz'
import {
  createIntakeForm, listIntakeFormsForClient, getIntakeFormForClient,
  reopenIntake, rotateIntakeToken, markIntakeSent, listIntakeFiles,
  deleteIntakeForm, updateIntakeDefinition, renameIntakeForm,
  getIntakeDefaultRecipients, saveIntakeDefaultRecipients,
  setFormRecipients, listTeamRecipients,
} from '../../../../lib/intake'
import {
  completion, normaliseDefinition,
  type TemplateKey, type TemplateDefinition,
} from '../../../../lib/intake-core'

/**
 * Intake forms for one client.
 *
 * Reading is editor+, so anyone who can see the client can read what they said.
 * Creating, editing, rotating, reopening and deleting are super_admin only —
 * consistent with every other client-scoped write, and enforced here rather
 * than by the UI hiding buttons.
 *
 * Every mutation resolves the form THROUGH the client, so a form id belonging
 * to a different client cannot be operated on by someone who knows it.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const [forms, team, defaultRecipients] = await Promise.all([
      listIntakeFormsForClient(id), listTeamRecipients(), getIntakeDefaultRecipients(),
    ])

    return NextResponse.json({
      can_manage: roleSatisfies(user.role, 'super_admin'),
      team,
      default_recipients: defaultRecipients,
      forms: await Promise.all(forms.map(async f => ({
        id: f.id,
        title: f.title,
        token: f.token,
        status: f.status,
        template_key: f.template_key,
        sent_at: f.sent_at,
        first_opened_at: f.first_opened_at,
        submitted_at: f.submitted_at,
        notify_emails: f.notify_emails,
        definition: f.definition,
        answers: f.answers,
        completion: completion(f.definition, f.answers),
        files: await listIntakeFiles(f.id),
      }))),
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

    // Copying an existing form beats starting from the template when a client
    // resembles one you have already tailored for. The source is resolved
    // through the DB rather than trusted from the body, and its questions are
    // repaired the same way any stored definition is.
    let copyFrom: TemplateDefinition | undefined
    const sourceId = String(body?.copy_from_form_id ?? '')
    if (sourceId) {
      const { data: src } = await supabase
        .from('intake_forms').select('definition, template_key').eq('id', sourceId).maybeSingle()
      if (src?.definition) {
        copyFrom = normaliseDefinition(src.definition, (src.template_key ?? key) as TemplateKey)
      }
    }

    const form = await createIntakeForm(id, key, admin.id, String(body?.title ?? ''), copyFrom)
    return NextResponse.json(
      { id: form.id, token: form.token, status: form.status, title: form.title },
      { status: 201 },
    )
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const form = await getIntakeFormForClient(id, String(body?.form_id ?? ''))
    if (!form) return NextResponse.json({ error: 'No such form on this client' }, { status: 404 })

    switch (body?.action) {
      case 'reopen':
        await reopenIntake(form.id)
        return NextResponse.json({ ok: true })

      case 'rotate':
        return NextResponse.json({ token: await rotateIntakeToken(form.id) })

      case 'mark_sent':
        await markIntakeSent(form.id)
        return NextResponse.json({ ok: true })

      case 'set_recipients': {
        // `emails: null` means "go back to inheriting the default"
        const emails = body?.emails === null ? null : body?.emails
        await setFormRecipients(form.id, emails)
        // one control, two scopes: ticking "use for all" writes the same list
        // as the agency default, so the next form created inherits it
        if (body?.apply_to_all && emails !== null) {
          const admin = await requireRole('super_admin')
          await saveIntakeDefaultRecipients(emails, admin.email)
        }
        return NextResponse.json({ ok: true })
      }

      case 'rename':
        await renameIntakeForm(form.id, String(body?.title ?? ''))
        return NextResponse.json({ ok: true })

      case 'update_definition': {
        // repaired rather than trusted: duplicate ids silently merge two
        // questions' answers, and an unknown type renders as nothing
        const definition = normaliseDefinition(body?.definition, form.template_key)
        if (definition.sections.length === 0) {
          return NextResponse.json({ error: 'A form needs at least one section' }, { status: 400 })
        }
        const ok = await updateIntakeDefinition(form.id, definition)
        if (!ok) {
          return NextResponse.json({
            error: 'The client has already started filling this in, so the questions are locked.',
          }, { status: 409 })
        }
        return NextResponse.json({ definition })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/**
 * Delete a form. Deleting takes the client's answers with it and there is no
 * undo, so a form with answers requires `?confirm=answers` — the destructive
 * case cannot happen on a stray click while the harmless one stays one button.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const url = new URL(req.url)
    const form = await getIntakeFormForClient(id, url.searchParams.get('form_id') ?? '')
    if (!form) return NextResponse.json({ error: 'No such form on this client' }, { status: 404 })

    const answered = completion(form.definition, form.answers).answered
    if (answered > 0 && url.searchParams.get('confirm') !== 'answers') {
      return NextResponse.json({
        error: `This form has ${answered} answer${answered === 1 ? '' : 's'} from the client. Deleting cannot be undone.`,
        answered,
        needs_confirmation: true,
      }, { status: 409 })
    }

    await deleteIntakeForm(form.id)
    return NextResponse.json({ ok: true, deleted_answers: answered })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
