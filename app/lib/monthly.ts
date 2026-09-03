import 'server-only'
import { randomUUID } from 'node:crypto'
import { DbError, table } from '@/lib/db'
import type { MonthlyUpdate } from '@/lib/db-types'
import { monthlyTemplate } from './monthly-templates'
import {
  mergeAnswers, nextStatus, isWritable, normaliseRecipients,
  type Answers, type IntakeStatus, type TemplateDefinition,
} from './intake-core'
import { monthlyTitle, normaliseMonth, normaliseYear } from './monthly-core'

// the team picker is identical to intake's — reuse it rather than a second copy
export { listTeamRecipients } from './intake'

/**
 * Monthly-update persistence. The rules live in intake-core.ts / monthly-core.ts
 * (both pure); this file only does the database work.
 *
 * DEGRADE-SAFE: on a database where no monthly form has ever been made there
 * is no `monthly_updates` node at all. Every READ below tolerates that — an
 * absent node reads as no rows, so the client page and the dashboard tab show
 * an empty state, never a 500.
 */

export type MonthlyForm = {
  id: string
  client_id: string
  month: number
  year: number
  title: string
  definition: TemplateDefinition
  token: string
  status: IntakeStatus
  answers: Answers
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  reopened_at: string | null
  /** null = fall back to the sending mailbox; [] = notify nobody */
  notify_emails: string[] | null
}

/**
 * Create the planning form for one client-month.
 *
 * One per (client, month, year), so a second create for a month that already
 * has a form must OPEN the existing one rather than error or duplicate — the
 * caller is told which happened.
 *
 * The definition is COPIED in, not referenced — editing monthly-templates.ts
 * later must not alter a form a client is halfway through. `copyFrom` lets the
 * create dialog carry last month's (possibly customised) questions forward.
 */
export async function createMonthlyForm(input: {
  clientId: string
  month: number
  year: number
  createdBy: string
  title?: string
  notifyEmails?: string[]
  copyFrom?: TemplateDefinition
}): Promise<{ form: MonthlyForm; existed: boolean }> {
  const month = normaliseMonth(input.month)
  const year = normaliseYear(input.year)
  if (month === null || year === null) throw new Error('Pick a valid month and year')

  const def = input.copyFrom ?? monthlyTemplate()
  const title = (input.title ?? '').trim() || monthlyTitle(month, year)

  // already a form for this client-month → open it instead of duplicating
  const already = await getMonthlyForClientMonth(input.clientId, month, year)
  if (already) return { form: already, existed: true }

  try {
    const row = await table('monthly_updates').insert({
      client_id: input.clientId, month, year, definition: def,
      created_by: input.createdBy, title,
      notify_emails: normaliseRecipients(input.notifyEmails ?? []),
      // the client's only credential for the form, and its starting state —
      // both minted here now that no column default mints them
      token: randomUUID(),
      status: 'draft',
      answers: {},
    })
    return { form: row as unknown as MonthlyForm, existed: false }
  } catch (e) {
    // a concurrent create won the token; whichever row exists is the one to open
    if (e instanceof DbError && e.code === 'unique') {
      const existing = await getMonthlyForClientMonth(input.clientId, month, year)
      if (existing) return { form: existing, existed: true }
    }
    throw new Error(e instanceof Error ? e.message : 'Could not create the form')
  }
}

/** The form for an exact client-month, or null. */
export async function getMonthlyForClientMonth(
  clientId: string, month: number, year: number,
): Promise<MonthlyForm | null> {
  const rows = await table<MonthlyUpdate>('monthly_updates').list({
    by: { client_id: clientId },
    where: r => r.month === month && r.year === year,
    limit: 1,
  })
  return (rows[0] as unknown as MonthlyForm) ?? null
}

/** The most recent PRIOR form on this client, for "copy last month's questions
 *  & recipients". Tolerates a missing table (returns null). */
export async function getLatestMonthlyForClient(clientId: string): Promise<MonthlyForm | null> {
  const rows = await table<MonthlyUpdate>('monthly_updates').list({
    by: { client_id: clientId },
    orderBy: [['year', 'desc'], ['month', 'desc']],
    limit: 1,
  })
  return (rows[0] as unknown as MonthlyForm) ?? null
}

export async function getMonthlyByToken(token: string): Promise<MonthlyForm | null> {
  const row = (await table<MonthlyUpdate>('monthly_updates').list({ by: { token }, limit: 1 }))[0]
  if (!row) return null
  const form = row as unknown as MonthlyForm
  // first open is recorded, but does NOT advance status — "started" means typed
  if (!form.first_opened_at) {
    await table<MonthlyUpdate>('monthly_updates')
      .update(form.id, { first_opened_at: new Date().toISOString() })
  }
  return form
}

/** Every monthly form on this client, newest month first. Tolerates a missing
 *  table — the client page and the dashboard tab must render an empty state,
 *  never 500, until the SQL is run. */
export async function listMonthlyFormsForClient(clientId: string): Promise<MonthlyForm[]> {
  const rows = await table<MonthlyUpdate>('monthly_updates').list({
    by: { client_id: clientId },
    orderBy: [['year', 'desc'], ['month', 'desc']],
  })
  return rows as unknown as MonthlyForm[]
}

/** One form, but only if it belongs to this client — so a form id from another
 *  client cannot be operated on by anyone who knows it. */
export async function getMonthlyFormForClient(
  clientId: string, formId: string,
): Promise<MonthlyForm | null> {
  const row = await table<MonthlyUpdate>('monthly_updates').get(formId)
  return row && row.client_id === clientId ? (row as unknown as MonthlyForm) : null
}

export async function renameMonthlyForm(formId: string, title: string): Promise<void> {
  await table<MonthlyUpdate>('monthly_updates')
    .update(formId, { title: title.trim().slice(0, 120) || 'Monthly update' })
}

/** Merge one autosave patch. A submitted form silently accepts nothing, so a
 *  forwarded link cannot rewrite answers a plan was built on. */
export async function saveMonthlyAnswers(
  token: string, patch: unknown,
): Promise<{ answers: Answers; status: IntakeStatus } | null> {
  const row = (await table<MonthlyUpdate>('monthly_updates').list({ by: { token }, limit: 1 }))[0]
  if (!row) return null

  const status = row.status as IntakeStatus
  const current = (row.answers ?? {}) as Answers
  if (!isWritable(status)) return { answers: current, status }

  const answers = mergeAnswers(row.definition as TemplateDefinition, current, patch)
  const next = nextStatus(status, 'save')
  await table<MonthlyUpdate>('monthly_updates').update(row.id, { answers, status: next })
  return { answers, status: next }
}

export async function submitMonthly(token: string): Promise<MonthlyForm | null> {
  const row = (await table<MonthlyUpdate>('monthly_updates').list({ by: { token }, limit: 1 }))[0]
  if (!row) return null
  const form = row as unknown as MonthlyForm
  if (!isWritable(form.status)) return form

  // the status is re-read immediately before the write, so only the caller who
  // still sees a writable form submits it and a double-click cannot send two
  // notifications
  const live = await table<MonthlyUpdate>('monthly_updates').get(form.id)
  if (!live || live.status === 'submitted') return form
  const updated = await table<MonthlyUpdate>('monthly_updates')
    .update(form.id, { status: 'submitted', submitted_at: new Date().toISOString() })
  return (updated as unknown as MonthlyForm) ?? form
}

export async function reopenMonthly(formId: string): Promise<void> {
  await table<MonthlyUpdate>('monthly_updates')
    .update(formId, { status: 'in_progress', reopened_at: new Date().toISOString() })
}

/** A forwarded link is a real scenario — rotating invalidates the old one. */
export async function rotateMonthlyToken(formId: string): Promise<string> {
  const updated = await table<MonthlyUpdate>('monthly_updates')
    .update(formId, { token: randomUUID() })
  if (!updated) throw new Error('That form no longer exists')
  return updated.token
}

/** Marks the form as sent. Only moves a draft, so re-copying the link later
 *  never rewrites the date it actually went out. */
export async function markMonthlySent(formId: string): Promise<void> {
  const form = await table<MonthlyUpdate>('monthly_updates').get(formId)
  if (form?.status !== 'draft') return
  await table<MonthlyUpdate>('monthly_updates')
    .update(formId, { status: 'sent', sent_at: new Date().toISOString() })
}

export async function deleteMonthlyForm(formId: string): Promise<void> {
  await table('monthly_updates').remove(formId)
}

/**
 * Replace the questions on one form — editable until SUBMITTED, not until
 * opened. Answers key off stable block ids, so editing questions mid-fill never
 * orphans what the client typed. Zero rows updated means it is already
 * submitted, and the caller is told.
 */
export async function updateMonthlyDefinition(
  formId: string, definition: TemplateDefinition,
): Promise<boolean> {
  const form = await table<MonthlyUpdate>('monthly_updates').get(formId)
  if (!form || form.status === 'submitted') return false
  const updated = await table<MonthlyUpdate>('monthly_updates').update(formId, { definition })
  return Boolean(updated)
}

/** Set one form's own recipients. Pass null to fall back to the default. */
export async function setMonthlyRecipients(
  formId: string, raw: unknown,
): Promise<string[] | null> {
  const notify_emails = raw === null ? null : normaliseRecipients(raw)
  await table<MonthlyUpdate>('monthly_updates').update(formId, { notify_emails })
  return notify_emails
}
