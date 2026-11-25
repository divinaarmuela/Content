import 'server-only'
import { table } from '@/lib/db'
import type { Client, TeamUser as TeamUserRow, UserPageAccess } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { AuthzError } from './authz'
import { userMaySeePage } from './page-access'
import { accessibleClientIds } from './production-access'
import {
  UPSELLS_PAGE, mayChangeUpsell, mayDeleteUpsell, mayMarkPaid, sanitiseUpsellInput, stagePatch,
  RETAINER_COMMISSION_MONTHS, type Upsell,
} from './upsell-core'

/**
 * THE UPSELL TRACKER — the server's half (rules in upsell-core). Every function here asks page access first: the
 * tracker holds prices and commission, so it is a super admin's and the named people's it is opened to, and a
 * hidden sidebar link is not what keeps the rest out.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409; reason: string; fresh?: Upsell | null }

const rows = () => table<Upsell>('upsells')

/** Refuses anyone the page is not opened to. */
export async function requireUpsells(user: TeamUser): Promise<void> {
  if (user.role === 'client' || !(await userMaySeePage(user, UPSELLS_PAGE))) throw new AuthzError('The upsell tracker is not open to you', 403)
}

/** The people on the tracker: super admins, and everyone it is opened to by name. */
export async function upsellPeople(): Promise<{ id: string; name: string }[]> {
  const [team, grants] = await Promise.all([
    table<TeamUserRow>('team_users').list({ where: r => r.role !== 'client' && r.active_status === true }),
    table<UserPageAccess & { hidden?: boolean }>('user_page_access').list({ by: { href: UPSELLS_PAGE } as never }),
  ])
  const granted = new Set(grants.filter(g => !g.hidden).map(g => g.team_user_id))
  return team
    .filter(u => u.role === 'super_admin' || granted.has(u.id))
    .map(u => ({ id: u.id, name: u.name || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The clients this person may log an upsell for: their own, or every client for a super admin. */
export async function upsellClients(user: TeamUser): Promise<{ id: string; name: string }[]> {
  const ids = await accessibleClientIds(user)
  const all = await table<Client>('clients').list({ where: c => String((c as { status?: string }).status ?? '') !== 'lead' })
  return all
    .filter(c => ids === null || ids.includes(c.id))
    .map(c => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listUpsells(): Promise<Upsell[]> {
  return (await rows().list()).sort((a, b) => String(b.logged_at).localeCompare(String(a.logged_at)))
}

export async function createUpsell(user: TeamUser, raw: unknown): Promise<Result<Upsell>> {
  const input = sanitiseUpsellInput(raw)
  if (!input.client_id) return { ok: false, status: 400, reason: 'Choose the client' }
  if (!input.service_name || !input.billing || !input.category) return { ok: false, status: 400, reason: 'Choose the service' }
  if (input.amount === undefined) return { ok: false, status: 400, reason: 'Enter the amount, in dollars' }
  const clients = await upsellClients(user)
  const client = clients.find(c => c.id === input.client_id)
  if (!client) return { ok: false, status: 403, reason: 'That client is not one of yours' }

  // whose upsell it is: your own, unless a super admin is logging it for somebody on the tracker
  let pitcher = { id: user.id, name: user.name }
  if (input.pitched_by && input.pitched_by !== user.id) {
    if (user.role !== 'super_admin') return { ok: false, status: 403, reason: 'Only a super admin logs an upsell for somebody else' }
    const other = (await upsellPeople()).find(p => p.id === input.pitched_by)
    if (!other) return { ok: false, status: 400, reason: 'That person is not on the upsell tracker' }
    pitcher = other
  }

  const now = new Date().toISOString()
  const stage = input.stage ?? 'logged'
  const base: Omit<Upsell, 'id'> = {
    client_id: client.id, client_name: client.name,
    service_key: input.service_key ?? null, service_name: input.service_name, category: input.category, billing: input.billing,
    amount: input.amount, stage: 'logged', paid: false, months_paid: 0, paid_at: null,
    pitched_by: pitcher.id, pitched_by_name: pitcher.name,
    logged_at: now, pitched_at: null, won_at: null, lost_at: null,
    notes: input.notes ?? null, created_by: user.id, created_at: now, updated_at: now, rev: 1,
  }
  const made = await rows().insert({ ...base, ...(stage === 'logged' ? {} : stagePatch(base, stage, now)) } as never)
  return { ok: true, value: made }
}

/**
 * Change a row. `expect_rev` is the version the person was looking at: a row somebody else changed in between is
 * refused with the row as it is now (never check-then-write — the claim re-reads and decides inside itself).
 */
export async function patchUpsell(user: TeamUser, id: string, raw: unknown): Promise<Result<Upsell>> {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const expect = Number(body.expect_rev)
  if (!Number.isInteger(expect)) return { ok: false, status: 400, reason: 'Reload the page and try again' }
  const input = sanitiseUpsellInput(body)
  const wantsPaid = 'paid' in body || 'months_paid' in body
  const viewer = { id: user.id, role: user.role }
  const now = new Date().toISOString()

  let refusal: Result<Upsell> | null = null
  const res = await rows().claim(id, current => {
    refusal = null
    if (!current) { refusal = { ok: false, status: 404, reason: 'That upsell is gone' }; return null }
    if (current.rev !== expect) { refusal = { ok: false, status: 409, reason: 'Somebody changed this just now — here it is as it stands', fresh: current }; return null }
    const touchesRow = Object.keys(input).length > 0
    if (touchesRow && !mayChangeUpsell(viewer, current)) { refusal = { ok: false, status: 403, reason: 'Only the person who pitched it, or a super admin, changes this' }; return null }
    if (wantsPaid && !mayMarkPaid(viewer)) { refusal = { ok: false, status: 403, reason: 'Only a super admin marks an upsell paid' }; return null }

    const { stage, client_id: _client, pitched_by: _who, ...fields } = input
    void _client; void _who
    let next: Upsell = { ...current, ...fields }
    if (stage && stage !== current.stage) next = { ...next, ...stagePatch(current, stage, now) }
    if (wantsPaid) {
      if (next.stage !== 'won') { refusal = { ok: false, status: 400, reason: 'Mark it Won before marking it paid' }; return null }
      if (next.billing === 'monthly') {
        const m = Number(body.months_paid)
        if (!Number.isInteger(m) || m < 0 || m > RETAINER_COMMISSION_MONTHS) { refusal = { ok: false, status: 400, reason: `Months paid is 0 to ${RETAINER_COMMISSION_MONTHS}` }; return null }
        next = { ...next, months_paid: m, paid: m >= RETAINER_COMMISSION_MONTHS, paid_at: m > 0 ? (current.paid_at ?? now) : null }
      } else {
        const paid = body.paid === true
        next = { ...next, paid, months_paid: 0, paid_at: paid ? (current.paid_at ?? now) : null }
      }
    }
    return { ...next, rev: current.rev + 1, updated_at: now }
  })
  if (res.claimed) return { ok: true, value: res.row }
  return refusal ?? { ok: false, status: 409, reason: 'Somebody changed this just now — here it is as it stands', fresh: res.current }
}

export async function deleteUpsell(user: TeamUser, id: string): Promise<Result<true>> {
  const current = await rows().get(id, { fresh: true })
  if (!current) return { ok: false, status: 404, reason: 'That upsell is gone' }
  if (!mayDeleteUpsell({ id: user.id, role: user.role }, current)) return { ok: false, status: 403, reason: 'Only a super admin deletes an upsell that was won' }
  await rows().remove(id)
  return { ok: true, value: true }
}
