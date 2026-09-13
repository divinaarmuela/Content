import { personLabel } from './identity-core'

/**
 * PEOPLE PICKERS, GROUPED BY ROLE (the owner, 13 Sep 2026: "show super
 * admins with their header, editors with their header, and AMs, nicely").
 * One order everywhere, so the same person is found in the same place on
 * every dropdown: the people who usually do the job first.
 */
export type PickablePerson = { id: string; name: string; role: string; email?: string | null }

export const ROLE_GROUP_ORDER = ['editor', 'account_manager', 'super_admin', 'scheduler', 'quality_checker', 'general'] as const

export const ROLE_GROUP_LABEL: Record<string, string> = {
  editor: 'Editors',
  account_manager: 'Account managers',
  super_admin: 'Super admins',
  scheduler: 'Schedulers',
  quality_checker: 'Quality checkers',
  general: 'Team',
}

export type PeopleGroup = { role: string; label: string; people: PickablePerson[] }

/** The people, in role groups, each group sorted by name; empty groups are
 *  left out. `first` puts a role's group at the top (the editor picker leads
 *  with Editors; a crew picker leads with whoever is passed). */
export function groupPeople(people: readonly PickablePerson[], first?: string): PeopleGroup[] {
  const order = [...ROLE_GROUP_ORDER] as string[]
  if (first && order.includes(first)) order.splice(order.indexOf(first), 1), order.unshift(first)
  const byRole = new Map<string, PickablePerson[]>()
  for (const p of people) {
    if (p.role === 'client') continue
    const key = order.includes(p.role) ? p.role : 'general'
    byRole.set(key, [...(byRole.get(key) ?? []), p])
  }
  return order
    .filter(r => (byRole.get(r) ?? []).length > 0)
    .map(r => ({
      role: r,
      label: ROLE_GROUP_LABEL[r] ?? r,
      people: [...(byRole.get(r) ?? [])].sort((a, b) => personWords(a).localeCompare(personWords(b))),
    }))
}

/** A person's name for a list: never a bare email address. */
export function personWords(p: Pick<PickablePerson, 'name' | 'email'>): string {
  return personLabel(p.name, p.email) || p.name || String(p.email ?? '')
}
