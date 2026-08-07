import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { templateFor } from './intake-templates'
import { normaliseDefinition } from './intake-core'
import {
  mergeAnswers, nextStatus, isWritable, normaliseRecipients,
  type Answers, type IntakeStatus, type TemplateKey, type TemplateDefinition,
} from './intake-core'

/**
 * Intake form persistence. The rules live in intake-core.ts; this file only
 * does the database work.
 */

export type IntakeForm = {
  id: string
  client_id: string
  title: string
  template_key: TemplateKey
  definition: TemplateDefinition
  token: string
  status: IntakeStatus
  answers: Answers
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  reopened_at: string | null
  /** null = inherit the agency default; [] = notify nobody */
  notify_emails: string[] | null
}

export type IntakeFile = { block_id: string; filename: string; url: string }

const COLS =
  'id, client_id, title, template_key, definition, token, status, answers, ' +
  'sent_at, first_opened_at, submitted_at, reopened_at, notify_emails'

/** Create a form for this client. The template definition is COPIED in, not
 *  referenced — editing intake-templates.ts later must not alter a form a
 *  client is halfway through. */
/**
 * The questions a new form of this category starts from.
 *
 * A saved override wins over the code default, so an improvement made while
 * tailoring one client's form carries to every form created afterwards. The
 * code remains the fallback, which is what makes deleting a row a safe undo.
 */
export async function resolveTemplate(key: TemplateKey): Promise<TemplateDefinition> {
  const { data } = await supabase
    .from('intake_templates').select('definition').eq('key', key).maybeSingle()
  if (!data?.definition) return templateFor(key)
  // repaired, not trusted: a stored override came from a browser once
  const def = normaliseDefinition(data.definition, key)
  return def.sections.length > 0 ? def : templateFor(key)
}

/** Save the questions as the default for this category. */
export async function saveTemplateDefinition(
  key: TemplateKey, definition: TemplateDefinition, by: string,
): Promise<void> {
  const { error } = await supabase.from('intake_templates').upsert({
    key, definition, updated_at: new Date().toISOString(), updated_by: by,
  })
  if (error) throw new Error(error.message)
}

export async function createIntakeForm(
  clientId: string, key: TemplateKey, createdBy: string, title = '',
): Promise<IntakeForm> {
  const def = await resolveTemplate(key)
  const { data, error } = await supabase
    .from('intake_forms')
    .insert({
      client_id: clientId, template_key: def.key, definition: def,
      created_by: createdBy, title: title.trim() || def.name,
    })
    .select(COLS)
    .single()
  if (error) throw new Error(error.message)
  return data as unknown as IntakeForm
}

export async function getIntakeByToken(token: string): Promise<IntakeForm | null> {
  const { data } = await supabase
    .from('intake_forms').select(COLS).eq('token', token).maybeSingle()
  if (!data) return null
  const form = data as unknown as IntakeForm
  // first open is recorded, but does NOT advance status — "started" means typed
  if (!form.first_opened_at) {
    await supabase.from('intake_forms')
      .update({ first_opened_at: new Date().toISOString() }).eq('id', form.id)
  }
  return form
}

/** Every form on this client, newest first. */
export async function listIntakeFormsForClient(clientId: string): Promise<IntakeForm[]> {
  const { data } = await supabase
    .from('intake_forms').select(COLS)
    .eq('client_id', clientId).order('created_at', { ascending: false })
  return (data ?? []) as unknown as IntakeForm[]
}

/** One form, but only if it belongs to this client — so a form id from another
 *  client cannot be operated on by anyone who knows it. */
export async function getIntakeFormForClient(
  clientId: string, formId: string,
): Promise<IntakeForm | null> {
  const { data } = await supabase
    .from('intake_forms').select(COLS)
    .eq('client_id', clientId).eq('id', formId).maybeSingle()
  return (data as unknown as IntakeForm) ?? null
}

export async function renameIntakeForm(formId: string, title: string): Promise<void> {
  const { error } = await supabase.from('intake_forms')
    .update({ title: title.trim().slice(0, 120) || 'Intake form' }).eq('id', formId)
  if (error) throw new Error(error.message)
}

/**
 * Merge one autosave patch.
 *
 * Read-modify-write on a JSONB column is a lost-update risk in general, but the
 * writer here is one person typing into one form. The guard that matters is the
 * status one: a submitted form silently accepts nothing, so a forwarded link
 * cannot rewrite answers a shot list was built on.
 */
export async function saveIntakeAnswers(
  token: string, patch: unknown,
): Promise<{ answers: Answers; status: IntakeStatus } | null> {
  const { data } = await supabase
    .from('intake_forms').select('id, status, answers, definition')
    .eq('token', token).maybeSingle()
  if (!data) return null

  const status = data.status as IntakeStatus
  const current = (data.answers ?? {}) as Answers
  if (!isWritable(status)) return { answers: current, status }

  const answers = mergeAnswers(data.definition as TemplateDefinition, current, patch)
  const next = nextStatus(status, 'save')
  const { error } = await supabase
    .from('intake_forms').update({ answers, status: next }).eq('id', data.id)
  if (error) throw new Error(error.message)
  return { answers, status: next }
}

export async function submitIntake(token: string): Promise<IntakeForm | null> {
  const { data } = await supabase
    .from('intake_forms').select(COLS).eq('token', token).maybeSingle()
  if (!data) return null
  const form = data as unknown as IntakeForm
  if (!isWritable(form.status)) return form

  // optimistic concurrency: only the caller who saw a writable status wins,
  // so a double-click cannot send two notifications
  const { data: updated } = await supabase
    .from('intake_forms')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', form.id).neq('status', 'submitted')
    .select(COLS).maybeSingle()
  return (updated as unknown as IntakeForm) ?? form
}

export async function reopenIntake(formId: string): Promise<void> {
  const { error } = await supabase.from('intake_forms')
    .update({ status: 'in_progress', reopened_at: new Date().toISOString() })
    .eq('id', formId)
  if (error) throw new Error(error.message)
}

/** A forwarded link is a real scenario — rotating invalidates the old one. */
export async function rotateIntakeToken(formId: string): Promise<string> {
  const { data, error } = await supabase.from('intake_forms')
    .update({ token: randomUUID() }).eq('id', formId)
    .select('token').single()
  if (error) throw new Error(error.message)
  return data.token as string
}

/** Marks the form as sent. Only moves a draft, so re-copying the link later
 *  never rewrites the date it actually went out. */
export async function markIntakeSent(formId: string): Promise<void> {
  await supabase.from('intake_forms')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', formId).eq('status', 'draft')
}

/** Remove the form entirely so a different template can be chosen. One form per
 *  client is a unique index, so without this a wrong choice is permanent.
 *  intake_files cascades. */
export async function deleteIntakeForm(formId: string): Promise<void> {
  const { error } = await supabase.from('intake_forms').delete().eq('id', formId)
  if (error) throw new Error(error.message)
}

/**
 * Replace the questions on one form.
 *
 * Only while the client has not started — `.in('status', ...)` is the guard, so
 * a client typing at the same moment cannot have the form rearranged underneath
 * them. Zero rows updated means they began first, and the caller is told.
 */
export async function updateIntakeDefinition(
  formId: string, definition: TemplateDefinition,
): Promise<boolean> {
  const { data } = await supabase
    .from('intake_forms')
    .update({ definition })
    .eq('id', formId).in('status', ['draft', 'sent'])
    .select('id').maybeSingle()
  return Boolean(data)
}

/**
 * Record an uploaded file, and mark its block as answered.
 *
 * The row in intake_files is what the dashboard links to; the filename in
 * `answers` is what makes the block count as answered. Without the second
 * write, completion() — which only ever reads `answers` — reports a section
 * as 6/7 no matter how many files the client uploads, because it cannot see
 * a table it does not read.
 */
export async function addIntakeFile(
  formId: string, blockId: string, filename: string, url: string, size: number,
): Promise<void> {
  const { error } = await supabase.from('intake_files')
    .insert({ form_id: formId, block_id: blockId, filename, url, size_bytes: size })
  if (error) throw new Error(error.message)

  const { data } = await supabase
    .from('intake_forms').select('answers').eq('id', formId).maybeSingle()
  const answers = ((data?.answers ?? {}) as Answers)
  const current = answers[blockId]
  const list = Array.isArray(current) ? current : []
  if (list.includes(filename)) return

  await supabase.from('intake_forms')
    .update({ answers: { ...answers, [blockId]: [...list, filename] } })
    .eq('id', formId)
}

export async function listIntakeFiles(formId: string): Promise<IntakeFile[]> {
  const { data } = await supabase.from('intake_files')
    .select('block_id, filename, url').eq('form_id', formId)
    .order('created_at', { ascending: true })
  return (data ?? []) as IntakeFile[]
}

/** The agency-wide default recipient list. Never throws: a missing row means
 *  no default, which resolveRecipients turns into the sending mailbox rather
 *  than into silence. */
export async function getIntakeDefaultRecipients(): Promise<string[]> {
  const { data } = await supabase
    .from('intake_settings').select('notify_emails').eq('id', 1).maybeSingle()
  return normaliseRecipients(data?.notify_emails)
}

export async function saveIntakeDefaultRecipients(raw: unknown, by: string): Promise<string[]> {
  const notify_emails = normaliseRecipients(raw)
  const { error } = await supabase.from('intake_settings').upsert({
    id: 1, notify_emails, updated_at: new Date().toISOString(), updated_by: by,
  })
  if (error) throw new Error(error.message)
  return notify_emails
}

/** Set one form's own recipients. Pass null to go back to inheriting. */
export async function setFormRecipients(formId: string, raw: unknown): Promise<string[] | null> {
  const notify_emails = raw === null ? null : normaliseRecipients(raw)
  const { error } = await supabase
    .from('intake_forms').update({ notify_emails }).eq('id', formId)
  if (error) throw new Error(error.message)
  return notify_emails
}

/** Everyone who could be picked in the recipients dropdown: the active team. */
export async function listTeamRecipients(): Promise<{ name: string; email: string }[]> {
  const { data } = await supabase
    .from('team_users').select('name, email')
    .eq('active_status', true).order('name')
  return (data ?? []).filter(u => u.email) as { name: string; email: string }[]
}
