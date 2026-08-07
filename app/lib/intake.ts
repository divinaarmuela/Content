import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { templateFor } from './intake-templates'
import {
  mergeAnswers, nextStatus, isWritable,
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
  send_copy_to_client: boolean
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  reopened_at: string | null
}

export type IntakeFile = { block_id: string; filename: string; url: string }

const COLS =
  'id, client_id, title, template_key, definition, token, status, answers, ' +
  'send_copy_to_client, sent_at, first_opened_at, submitted_at, reopened_at'

/** Create a form for this client. The template definition is COPIED in, not
 *  referenced — editing intake-templates.ts later must not alter a form a
 *  client is halfway through. */
export async function createIntakeForm(
  clientId: string, key: TemplateKey, createdBy: string, title = '',
): Promise<IntakeForm> {
  const def = templateFor(key)
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

export async function addIntakeFile(
  formId: string, blockId: string, filename: string, url: string, size: number,
): Promise<void> {
  const { error } = await supabase.from('intake_files')
    .insert({ form_id: formId, block_id: blockId, filename, url, size_bytes: size })
  if (error) throw new Error(error.message)
}

export async function listIntakeFiles(formId: string): Promise<IntakeFile[]> {
  const { data } = await supabase.from('intake_files')
    .select('block_id, filename, url').eq('form_id', formId)
    .order('created_at', { ascending: true })
  return (data ?? []) as IntakeFile[]
}
