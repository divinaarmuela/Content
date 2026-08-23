/**
 * Pure work-kind logic — no I/O.
 *
 * A kind is the CRAFT of an item (video edit, graphics, copywriting,
 * strategy); content_type stays the deliverable FORMAT and keeps driving
 * agreements, quotas, and publishing untouched. Kinds are team-managed data,
 * so everything a browser can get wrong is validated here, testably.
 */

import type { Role } from './identity-core'

export const KIND_COLORS = ['zinc', 'pink', 'sky', 'indigo', 'violet', 'emerald', 'amber', 'rose'] as const
export type KindColor = (typeof KIND_COLORS)[number]

/** Anyone on the team can carry a task — never a client account. */
export const ASSIGNABLE_ROLES = ['scheduler', 'editor', 'account_manager', 'super_admin'] as const

export type WorkKind = {
  id: string
  slug: string
  name: string
  default_roles: string[]
  uses_media: boolean
  color: string
  active: boolean
  sort_order: number
}

export type KindInput = {
  slug: string
  name: string
  default_roles: string[]
  uses_media: boolean
  color: string
}

/** System kinds that a user must not create or rename onto. */
export const RESERVED_KIND_SLUGS = new Set(['shoot_brief'])

export function validateKindInput(raw: unknown): { ok: true; value: KindInput } | { ok: false; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>
  const errors: string[] = []
  const slug = String(r.slug ?? '').trim().toLowerCase()
  if (!/^[a-z0-9_-]{1,40}$/.test(slug)) errors.push('Slug must be 1–40 of a–z, 0–9, - or _')
  // 'shoot_brief' is a system kind with a fixed uuid and a one-per-shoot index;
  // a hand-made kind squatting the slug would silently break that invariant
  else if (RESERVED_KIND_SLUGS.has(slug)) errors.push(`"${slug}" is a reserved work type`)
  const name = String(r.name ?? '').trim()
  if (!name || name.length > 80) errors.push('Name must be 1–80 characters')
  const roles = Array.isArray(r.default_roles) ? r.default_roles.map(x => String(x)) : []
  for (const role of roles) {
    if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
      errors.push(`"${role}" is not an assignable role`)
    }
  }
  const color = String(r.color ?? 'zinc')
  if (!(KIND_COLORS as readonly string[]).includes(color)) errors.push('Pick a colour from the list')
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: { slug, name, default_roles: [...new Set(roles)], uses_media: r.uses_media !== false, color },
  }
}

export type Member = { id: string; name: string; email: string; role: string; active_status?: boolean }

const ROLE_ORDER = ['editor', 'account_manager', 'super_admin', 'scheduler']

/** The assignee picker's shape: people whose role matches the kind first,
 *  then everyone else grouped by role — each person exactly once. */
export function orderAssignees(
  kind: { default_roles: string[] } | null,
  members: Member[],
): { suggested: Member[]; rest: Member[] } {
  const eligible = members.filter(m => m.role !== 'client' && m.active_status !== false)
  const byName = (a: Member, b: Member) => (a.name || a.email).localeCompare(b.name || b.email)
  if (!kind) return { suggested: [], rest: [...eligible].sort((a, b) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || byName(a, b)) }
  const suggested = eligible.filter(m => kind.default_roles.includes(m.role)).sort(byName)
  const suggestedIds = new Set(suggested.map(m => m.id))
  const rest = eligible.filter(m => !suggestedIds.has(m.id)).sort((a, b) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || byName(a, b))
  return { suggested, rest }
}

/** Which kind a write lands on: an explicit choice must exist and be active;
 *  no choice falls back to 'edit' (then the first active by sort order). */
export function resolveKindForWrite(
  kinds: WorkKind[],
  requestedId: string | null | undefined,
): { ok: true; id: string | null } | { ok: false; reason: string } {
  if (requestedId === undefined || requestedId === null || requestedId === '') {
    const edit = kinds.find(k => k.slug === 'edit' && k.active)
    if (edit) return { ok: true, id: edit.id }
    const first = [...kinds].filter(k => k.active).sort((a, b) => a.sort_order - b.sort_order)[0]
    return { ok: true, id: first?.id ?? null }
  }
  const kind = kinds.find(k => k.id === requestedId)
  if (!kind) return { ok: false, reason: 'That work type no longer exists' }
  if (!kind.active) return { ok: false, reason: `"${kind.name}" is archived — pick a current work type` }
  return { ok: true, id: kind.id }
}

/** May this person carry a task? Anyone active on the team; never a client. */
export function isValidOwner(member: { role: string; active_status?: boolean } | null): boolean {
  return member !== null && member.active_status !== false && member.role !== 'client'
}
