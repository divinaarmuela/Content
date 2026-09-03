import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type {
  IntakeFile as IntakeFileRow, IntakeForm as IntakeFormRow, IntakeTemplate, TeamUser,
} from '@/lib/db-types'
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

const forms = () => table<IntakeFormRow>('intake_forms')

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
  const row = (await table<IntakeTemplate>('intake_templates').list({
    where: t => t.key === key, limit: 1,
  }))[0]
  if (!row?.definition) return templateFor(key)
  // repaired, not trusted: a stored override came from a browser once
  const def = normaliseDefinition(row.definition, key)
  return def.sections.length > 0 ? def : templateFor(key)
}

/** Save the questions as the default for this category. */
export async function saveTemplateDefinition(
  key: TemplateKey, definition: TemplateDefinition, by: string,
): Promise<void> {
  await table('intake_templates').upsert({
    key, definition, updated_at: new Date().toISOString(), updated_by: by,
  })
}

export async function createIntakeForm(
  clientId: string, key: TemplateKey, createdBy: string, title = '',
  /** copy these questions instead of the category template — used when
   *  duplicating another client's form, which is usually closer to what you
   *  want than starting from the generic template again */
  copyFrom?: TemplateDefinition,
  /** recipients carried over when duplicating within the SAME client — another
   *  client's notification list must never follow the questions across */
  copyNotifyEmails?: string[] | null,
): Promise<IntakeForm> {
  const def = copyFrom ?? await resolveTemplate(key)
  // Postgres defaulted these three; the token IS the client's credential for
  // the form, so a missing one would be a dead link
  const row = await table('intake_forms').insert({
    client_id: clientId, template_key: def.key, definition: def,
    created_by: createdBy, title: title.trim() || def.name,
    token: randomUUID(), status: 'draft', answers: {},
    ...(copyNotifyEmails !== undefined ? { notify_emails: copyNotifyEmails } : {}),
  })
  return row as unknown as IntakeForm
}

export async function getIntakeByToken(token: string): Promise<IntakeForm | null> {
  const data = (await forms().list({ by: { token }, limit: 1 }))[0]
  if (!data) return null
  const form = data as unknown as IntakeForm
  // first open is recorded, but does NOT advance status — "started" means typed
  if (!form.first_opened_at) {
    await forms().update(form.id, { first_opened_at: new Date().toISOString() })
  }
  return form
}

/** Every form on this client, newest first. */
export async function listIntakeFormsForClient(clientId: string): Promise<IntakeForm[]> {
  const rows = await forms().list({
    by: { client_id: clientId },
    orderBy: [['created_at', 'desc']],
  })
  return rows as unknown as IntakeForm[]
}

/** One form, but only if it belongs to this client — so a form id from another
 *  client cannot be operated on by anyone who knows it. */
export async function getIntakeFormForClient(
  clientId: string, formId: string,
): Promise<IntakeForm | null> {
  const row = await forms().get(formId)
  if (!row || row.client_id !== clientId) return null
  return row as unknown as IntakeForm
}

export async function renameIntakeForm(formId: string, title: string): Promise<void> {
  await forms().update(formId, { title: title.trim().slice(0, 120) || 'Intake form' })
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
  const data = (await forms().list({ by: { token }, limit: 1 }))[0]
  if (!data) return null

  const status = data.status as IntakeStatus
  const current = (data.answers ?? {}) as Answers
  if (!isWritable(status)) return { answers: current, status }

  const answers = mergeAnswers(data.definition as TemplateDefinition, current, patch)
  const next = nextStatus(status, 'save')
  await forms().update(data.id, { answers, status: next })
  return { answers, status: next }
}

export async function submitIntake(token: string): Promise<IntakeForm | null> {
  const data = (await forms().list({ by: { token }, limit: 1 }))[0]
  if (!data) return null
  const form = data as unknown as IntakeForm
  if (!isWritable(form.status)) return form

  // only the caller who still sees an unsubmitted status writes, so a
  // double-click cannot send two notifications
  const submitted = await forms().claim(form.id, cur =>
    cur && cur.status !== 'submitted'
      ? { ...cur, status: 'submitted', submitted_at: new Date().toISOString() }
      : null)
  return submitted.claimed ? (submitted.row as unknown as IntakeForm) : form
}

export async function reopenIntake(formId: string): Promise<void> {
  await forms().update(formId, {
    status: 'in_progress', reopened_at: new Date().toISOString(),
  })
}

/** A forwarded link is a real scenario — rotating invalidates the old one. */
export async function rotateIntakeToken(formId: string): Promise<string> {
  const updated = await forms().update(formId, { token: randomUUID() })
  if (!updated) throw new Error('No such form')
  return updated.token
}

/** Marks the form as sent. Only moves a draft, so re-copying the link later
 *  never rewrites the date it actually went out. */
export async function markIntakeSent(formId: string): Promise<void> {
  await forms().claim(formId, cur =>
    cur?.status === 'draft'
      ? { ...cur, status: 'sent', sent_at: new Date().toISOString() }
      : null)
}

/** Remove the form entirely so a different template can be chosen. One form per
 *  client is a unique index, so without this a wrong choice is permanent.
 *  intake_files cascades. */
export async function deleteIntakeForm(formId: string): Promise<void> {
  await forms().remove(formId)
  await table<IntakeFileRow>('intake_files').removeWhere(f => f.form_id === formId)
}

/**
 * Replace the questions on one form.
 *
 * Only while the form has not been submitted — the status check is the guard,
 * so a client who has finished cannot have the form rearranged underneath
 * them. A submitted form writes nothing, and the caller is told.
 */
export async function updateIntakeDefinition(
  formId: string, definition: TemplateDefinition,
): Promise<boolean> {
  // Editable until SUBMITTED — not until opened. Answers key off stable block
  // ids, so editing questions mid-fill never orphans what the client typed;
  // a submitted form is a document a shot list gets built on, so that one
  // stays read-only until deliberately reopened.
  const changed = await forms().claim(formId, cur =>
    cur && cur.status !== 'submitted' ? { ...cur, definition } : null)
  return changed.claimed
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
  await table('intake_files')
    .insert({ form_id: formId, block_id: blockId, filename, url, size_bytes: size })

  const data = await forms().get(formId)
  const answers = ((data?.answers ?? {}) as Answers)
  const current = answers[blockId]
  const list = Array.isArray(current) ? current : []
  if (list.includes(filename)) return

  await forms().update(formId, { answers: { ...answers, [blockId]: [...list, filename] } })
}

export async function listIntakeFiles(formId: string): Promise<IntakeFile[]> {
  const rows = await table<IntakeFileRow>('intake_files').list({
    where: f => f.form_id === formId,
    orderBy: [['created_at', 'asc']],
  })
  return rows.map(f => ({ block_id: f.block_id, filename: f.filename, url: f.url }))
}

/** The agency-wide default recipient list. Never throws: a missing row means
 *  no default, which resolveRecipients turns into the sending mailbox rather
 *  than into silence. */
export async function getIntakeDefaultRecipients(): Promise<string[]> {
  try {
    const row = await table('intake_settings').get('singleton')
    return normaliseRecipients(row?.notify_emails)
  } catch {
    return normaliseRecipients(null)
  }
}

export async function saveIntakeDefaultRecipients(raw: unknown, by: string): Promise<string[]> {
  const notify_emails = normaliseRecipients(raw)
  await table('intake_settings').upsert({
    id: 'singleton', notify_emails, updated_at: new Date().toISOString(), updated_by: by,
  })
  return notify_emails
}

/** Set one form's own recipients. Pass null to go back to inheriting. */
export async function setFormRecipients(formId: string, raw: unknown): Promise<string[] | null> {
  const notify_emails = raw === null ? null : normaliseRecipients(raw)
  await forms().update(formId, { notify_emails })
  return notify_emails
}

/**
 * Which of a client's forms are toggled to show on the client portal, as a
 * { formId: boolean } map.
 *
 * Read TOLERANTLY: a failure here degrades to "nothing toggled on" (an empty
 * map) rather than taking the intake panel down. Every id defaults to false at
 * the call site.
 */
export async function getShowOnPortalFlags(clientId: string): Promise<Record<string, boolean>> {
  try {
    const rows = await forms().list({ by: { client_id: clientId } })
    const out: Record<string, boolean> = {}
    for (const r of rows) out[r.id] = r.show_on_portal === true
    return out
  } catch {
    return {}
  }
}

/** Turn one form's portal visibility on or off. Unlike the read above this is
 *  allowed to throw: it only runs from a deliberate super-admin click, and a
 *  toast telling them it failed is the honest outcome. */
export async function setShowOnPortal(formId: string, value: boolean): Promise<void> {
  await forms().update(formId, { show_on_portal: value })
}

/** Everyone who could be picked in the recipients dropdown: the active team. */
export async function listTeamRecipients(): Promise<{ name: string; email: string }[]> {
  const rows = await table<TeamUser>('team_users').list({
    by: { active_status: true },
    orderBy: [['name', 'asc']],
  })
  return rows.filter(u => u.email).map(u => ({ name: u.name, email: u.email }))
}
