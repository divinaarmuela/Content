import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse, roleSatisfies } from '../../../../lib/authz'
import {
  createMonthlyForm, listMonthlyFormsForClient, getMonthlyFormForClient,
  getLatestMonthlyForClient, reopenMonthly, rotateMonthlyToken, markMonthlySent,
  deleteMonthlyForm, updateMonthlyDefinition, renameMonthlyForm,
  setMonthlyRecipients, listTeamRecipients,
} from '../../../../lib/monthly'
import { completion, normaliseDefinition } from '../../../../lib/intake-core'
import {
  currentMonthYear, monthLabel, normaliseMonth, normaliseYear,
} from '../../../../lib/monthly-core'

/**
 * Monthly-update forms for one client.
 *
 * Reading is editor+, so anyone who can see the client can read what they said.
 * Creating, editing, rotating, reopening and deleting are super_admin only —
 * consistent with intake and every other client-scoped write, and enforced here
 * rather than by the UI hiding buttons.
 *
 * Every mutation resolves the form THROUGH the client, so a form id belonging to
 * a different client cannot be operated on by someone who knows it.
 *
 * DEGRADE-SAFE: all reads go through lib/monthly, which tolerates the table
 * being absent (returns empty) — so this endpoint answers 200 with an empty
 * list before the SQL is run, never 500.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
 return withRequestCache(async () => {
  try {
    const user = await requireRole('editor')
    const { id } = await params

    const [forms, team, previous] = await Promise.all([
      listMonthlyFormsForClient(id), listTeamRecipients(), getLatestMonthlyForClient(id),
    ])
    const now = currentMonthYear()

    return NextResponse.json({
      can_manage: roleSatisfies(user.role, 'super_admin'),
      team,
      default_month: now.month,
      default_year: now.year,
      // for the "copy last month's questions & recipients" convenience
      previous: previous
        ? { label: monthLabel(previous.month, previous.year), recipients: previous.notify_emails ?? [] }
        : null,
      forms: forms.map(f => ({
        id: f.id,
        title: f.title,
        month: f.month,
        year: f.year,
        period: monthLabel(f.month, f.year),
        token: f.token,
        status: f.status,
        sent_at: f.sent_at,
        first_opened_at: f.first_opened_at,
        submitted_at: f.submitted_at,
        notify_emails: f.notify_emails,
        definition: f.definition,
        answers: f.answers,
        completion: completion(f.definition, f.answers),
      })),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 return withRequestCache(async () => {
  try {
    const admin = await requireRole('super_admin')
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const now = currentMonthYear()
    const month = normaliseMonth(body?.month) ?? now.month
    const year = normaliseYear(body?.year) ?? now.year

    // "copy last month" carries the client's (possibly customised) questions —
    // and, when no explicit list is chosen, their recipients — forward
    let copyFrom
    let notifyEmails: string[] | undefined =
      Array.isArray(body?.notify_emails) ? body.notify_emails.map(String) : undefined
    if (body?.copy_previous) {
      const prev = await getLatestMonthlyForClient(id)
      if (prev) {
        copyFrom = prev.definition
        if (notifyEmails === undefined) notifyEmails = prev.notify_emails ?? []
      }
    }

    const { form, existed } = await createMonthlyForm({
      clientId: id, month, year, createdBy: admin.id,
      title: String(body?.title ?? ''), notifyEmails, copyFrom,
    })

    return NextResponse.json(
      {
        id: form.id, token: form.token, status: form.status, title: form.title,
        existed,
        // a clear message when create OPENED an existing form for that month
        message: existed
          ? `A form already exists for ${monthLabel(form.month, form.year)} — opening it.`
          : undefined,
      },
      { status: existed ? 200 : 201 },
    )
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
 return withRequestCache(async () => {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const form = await getMonthlyFormForClient(id, String(body?.form_id ?? ''))
    if (!form) return NextResponse.json({ error: 'No such form on this client' }, { status: 404 })

    switch (body?.action) {
      case 'reopen':
        await reopenMonthly(form.id)
        return NextResponse.json({ ok: true })

      case 'rotate':
        return NextResponse.json({ token: await rotateMonthlyToken(form.id) })

      case 'mark_sent':
        await markMonthlySent(form.id)
        return NextResponse.json({ ok: true })

      case 'set_recipients': {
        // `emails: null` means "fall back to the sending mailbox"
        const emails = body?.emails === null ? null : body?.emails
        await setMonthlyRecipients(form.id, emails)
        return NextResponse.json({ ok: true })
      }

      case 'rename':
        await renameMonthlyForm(form.id, String(body?.title ?? ''))
        return NextResponse.json({ ok: true })

      case 'update_definition': {
        // repaired rather than trusted: duplicate ids silently merge two
        // questions' answers, and an unknown type renders as nothing. 'one_off'
        // is the placeholder key the monthly template already carries.
        const definition = normaliseDefinition(body?.definition, 'one_off')
        if (definition.sections.length === 0) {
          return NextResponse.json({ error: 'A form needs at least one section' }, { status: 400 })
        }
        const ok = await updateMonthlyDefinition(form.id, definition)
        if (!ok) {
          return NextResponse.json({
            error: 'The client has already submitted this, so the questions are locked. Reopen it to edit.',
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
 })
}

/**
 * Delete a form. Deleting takes the client's answers with it and there is no
 * undo, so a form with answers requires `?confirm=answers`.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
 return withRequestCache(async () => {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const url = new URL(req.url)
    const form = await getMonthlyFormForClient(id, url.searchParams.get('form_id') ?? '')
    if (!form) return NextResponse.json({ error: 'No such form on this client' }, { status: 404 })

    const answered = completion(form.definition, form.answers).answered
    if (answered > 0 && url.searchParams.get('confirm') !== 'answers') {
      return NextResponse.json({
        error: `This form has ${answered} answer${answered === 1 ? '' : 's'} from the client. Deleting cannot be undone.`,
        answered,
        needs_confirmation: true,
      }, { status: 409 })
    }

    await deleteMonthlyForm(form.id)
    return NextResponse.json({ ok: true, deleted_answers: answered })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}
