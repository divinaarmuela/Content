import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabase } from '@/lib/supabase'
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
 * DEGRADE-SAFE: the `monthly_updates` table does not exist until a human runs
 * supabase/monthly_updates.sql. Every READ below tolerates that — a Supabase
 * select against a missing table returns `{ data: null, error }` rather than
 * throwing, so `data ?? []` / `?? null` yields an empty state, never a 500.
 * Only the WRITE paths (create/save/etc., all staff- or token-gated) surface an
 * error, which is correct: there is nothing to write yet.
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

const COLS =
  'id, client_id, month, year, title, definition, token, status, answers, ' +
  'sent_at, first_opened_at, submitted_at, reopened_at, notify_emails'

/**
 * Create the planning form for one client-month.
 *
 * One per (client, month, year) is a unique index, so a second create for a
 * month that already has a form must OPEN the existing one rather than error or
 * duplicate. The insert is attempted; a unique-violation (23505) is turned into
 * a fetch of the row that already exists, and the caller is told which happened.
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

  const { data, error } = await supabase
    .from('monthly_updates')
    .insert({
      client_id: input.clientId, month, year, definition: def,
      created_by: input.createdBy, title,
      notify_emails: normaliseRecipients(input.notifyEmails ?? []),
    })
    .select(COLS)
    .single()

  if (error) {
    // already a form for this client-month → open it instead of duplicating
    if (error.code === '23505') {
      const existing = await getMonthlyForClientMonth(input.clientId, month, year)
      if (existing) return { form: existing, existed: true }
    }
    throw new Error(error.message)
  }
  return { form: data as unknown as MonthlyForm, existed: false }
}

/** The form for an exact client-month, or null. */
export async function getMonthlyForClientMonth(
  clientId: string, month: number, year: number,
): Promise<MonthlyForm | null> {
  const { data } = await supabase
    .from('monthly_updates').select(COLS)
    .eq('client_id', clientId).eq('month', month).eq('year', year).maybeSingle()
  return (data as unknown as MonthlyForm) ?? null
}

/** The most recent PRIOR form on this client, for "copy last month's questions
 *  & recipients". Tolerates a missing table (returns null). */
export async function getLatestMonthlyForClient(clientId: string): Promise<MonthlyForm | null> {
  const { data } = await supabase
    .from('monthly_updates').select(COLS)
    .eq('client_id', clientId)
    .order('year', { ascending: false }).order('month', { ascending: false })
    .limit(1).maybeSingle()
  return (data as unknown as MonthlyForm) ?? null
}

export async function getMonthlyByToken(token: string): Promise<MonthlyForm | null> {
  const { data } = await supabase
    .from('monthly_updates').select(COLS).eq('token', token).maybeSingle()
  if (!data) return null
  const form = data as unknown as MonthlyForm
  // first open is recorded, but does NOT advance status — "started" means typed
  if (!form.first_opened_at) {
    await supabase.from('monthly_updates')
      .update({ first_opened_at: new Date().toISOString() }).eq('id', form.id)
  }
  return form
}

/** Every monthly form on this client, newest month first. Tolerates a missing
 *  table — the client page and the dashboard tab must render an empty state,
 *  never 500, until the SQL is run. */
export async function listMonthlyFormsForClient(clientId: string): Promise<MonthlyForm[]> {
  const { data } = await supabase
    .from('monthly_updates').select(COLS)
    .eq('client_id', clientId)
    .order('year', { ascending: false }).order('month', { ascending: false })
  return (data ?? []) as unknown as MonthlyForm[]
}

/** One form, but only if it belongs to this client — so a form id from another
 *  client cannot be operated on by anyone who knows it. */
export async function getMonthlyFormForClient(
  clientId: string, formId: string,
): Promise<MonthlyForm | null> {
  const { data } = await supabase
    .from('monthly_updates').select(COLS)
    .eq('client_id', clientId).eq('id', formId).maybeSingle()
  return (data as unknown as MonthlyForm) ?? null
}

export async function renameMonthlyForm(formId: string, title: string): Promise<void> {
  const { error } = await supabase.from('monthly_updates')
    .update({ title: title.trim().slice(0, 120) || 'Monthly update' }).eq('id', formId)
  if (error) throw new Error(error.message)
}

/** Merge one autosave patch. A submitted form silently accepts nothing, so a
 *  forwarded link cannot rewrite answers a plan was built on. */
export async function saveMonthlyAnswers(
  token: string, patch: unknown,
): Promise<{ answers: Answers; status: IntakeStatus } | null> {
  const { data } = await supabase
    .from('monthly_updates').select('id, status, answers, definition')
    .eq('token', token).maybeSingle()
  if (!data) return null

  const status = data.status as IntakeStatus
  const current = (data.answers ?? {}) as Answers
  if (!isWritable(status)) return { answers: current, status }

  const answers = mergeAnswers(data.definition as TemplateDefinition, current, patch)
  const next = nextStatus(status, 'save')
  const { error } = await supabase
    .from('monthly_updates').update({ answers, status: next }).eq('id', data.id)
  if (error) throw new Error(error.message)
  return { answers, status: next }
}

export async function submitMonthly(token: string): Promise<MonthlyForm | null> {
  const { data } = await supabase
    .from('monthly_updates').select(COLS).eq('token', token).maybeSingle()
  if (!data) return null
  const form = data as unknown as MonthlyForm
  if (!isWritable(form.status)) return form

  // optimistic concurrency: only the caller who saw a writable status wins, so
  // a double-click cannot send two notifications
  const { data: updated } = await supabase
    .from('monthly_updates')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', form.id).neq('status', 'submitted')
    .select(COLS).maybeSingle()
  return (updated as unknown as MonthlyForm) ?? form
}

export async function reopenMonthly(formId: string): Promise<void> {
  const { error } = await supabase.from('monthly_updates')
    .update({ status: 'in_progress', reopened_at: new Date().toISOString() })
    .eq('id', formId)
  if (error) throw new Error(error.message)
}

/** A forwarded link is a real scenario — rotating invalidates the old one. */
export async function rotateMonthlyToken(formId: string): Promise<string> {
  const { data, error } = await supabase.from('monthly_updates')
    .update({ token: randomUUID() }).eq('id', formId)
    .select('token').single()
  if (error) throw new Error(error.message)
  return data.token as string
}

/** Marks the form as sent. Only moves a draft, so re-copying the link later
 *  never rewrites the date it actually went out. */
export async function markMonthlySent(formId: string): Promise<void> {
  await supabase.from('monthly_updates')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', formId).eq('status', 'draft')
}

export async function deleteMonthlyForm(formId: string): Promise<void> {
  const { error } = await supabase.from('monthly_updates').delete().eq('id', formId)
  if (error) throw new Error(error.message)
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
  const { data } = await supabase
    .from('monthly_updates')
    .update({ definition })
    .eq('id', formId).neq('status', 'submitted')
    .select('id').maybeSingle()
  return Boolean(data)
}

/** Set one form's own recipients. Pass null to fall back to the default. */
export async function setMonthlyRecipients(
  formId: string, raw: unknown,
): Promise<string[] | null> {
  const notify_emails = raw === null ? null : normaliseRecipients(raw)
  const { error } = await supabase
    .from('monthly_updates').update({ notify_emails }).eq('id', formId)
  if (error) throw new Error(error.message)
  return notify_emails
}
