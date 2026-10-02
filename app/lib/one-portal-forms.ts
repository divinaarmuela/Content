import 'server-only'
import { table } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import type { PortalScope } from './portal-owner-core'
import { onePortal, onePortalPath } from './one-portal-core'
import { formLinkTarget, formRows, type FormKind, type PortalFormRow } from './one-portal-forms-core'

/**
 * The server half of the Shoot brief tab's forms (one-portal-forms-core.ts): reads a client's intake forms, monthly
 * updates and shoot-date proposals, and answers where an old `/intake/`, `/monthly/` or `/shoot/` link goes for a
 * client on the one portal. Each read degrades to nothing on its own — a form table failing never takes the
 * portal down. Forms are the business's: a person's own portal lists none.
 */

type FormRow = { id: string; client_id: string; token: string; title?: string | null; status?: string | null; created_at?: string | null; sent_at?: string | null }
type ProposalRow = { id: string; client_id: string; token: string; title?: string | null; status?: string | null; created_at?: string | null; starts_at?: string | null }

const TABLE: Record<FormKind, 'intake_forms' | 'monthly_updates' | 'shoot_proposals'> = {
  intake: 'intake_forms', monthly: 'monthly_updates', proposal: 'shoot_proposals',
}

export async function loadPortalForms(clientId: string, scope: PortalScope, tz: string): Promise<PortalFormRow[]> {
  if (scope.kind !== 'business') return []
  const read = <T,>(t: string) => table<T & { id: string }>(t as never).list({ by: { client_id: clientId } as never }).catch(() => [] as T[])
  const [intake, monthly, proposals] = await Promise.all([read<FormRow>('intake_forms'), read<FormRow>('monthly_updates'), read<ProposalRow>('shoot_proposals')])
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
  return formRows(intake, monthly, proposals, day)
}

/** One form of this client's, by id — any status, so a submitted form opens on its thank-you page. */
export async function portalFormById<T extends { client_id: string }>(kind: FormKind, id: string, clientId: string): Promise<(T & { id: string; token: string }) | null> {
  const row = await table<T & { id: string; token: string }>(TABLE[kind] as never).get(id).catch(() => null)
  return row && row.client_id === clientId && typeof row.token === 'string' ? row : null
}

/** Where an old form link goes: null unless its client is on the one portal (everyone else keeps today's page). */
export async function onePortalFormRedirect(kind: FormKind, token: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const row = (await table<FormRow>(TABLE[kind] as never).list({ by: { token } as never, limit: 1 }).catch(() => [] as FormRow[]))[0]
  if (!row) return null
  const client = await table<Client>('clients').get(row.client_id).catch(() => null)
  const home = typeof client?.share_token === 'string' ? client.share_token.trim() : ''
  if (!client || !onePortal(client) || !home) return null
  return formLinkTarget(onePortalPath(home), kind, row.id)
}
