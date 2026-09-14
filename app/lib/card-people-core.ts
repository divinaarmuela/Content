import { isQualityReviewer, roleLabel } from './identity-core'
import type { Mentionable } from './mention-core'

/**
 * THE PEOPLE ON A CARD — who "@" offers in a team note (the owner, 14 Sep
 * 2026: "if I click @ it will show email options available for tagging
 * within that card, like super admin, the AM and quality review").
 *
 * Not the whole team: the client's account managers, the quality
 * checkers, the super admins, whoever holds the card and whoever it was
 * handed to for scheduling — each once, with their email and their job, so
 * the right Priya is picked. The writer is never offered to themselves.
 * A name typed for anybody else on the team still tags them (the server
 * resolves "@Name" against the whole roster); this is only what the list
 * suggests. Pure.
 */
export type CardPerson = Mentionable & { email: string; hint: string }

export type CardPeopleCard = {
  client_id: string
  owner_id?: string | null
  scheduler_ids?: unknown
}
export type CardPeopleMember = {
  id: string
  name?: string | null
  email?: string | null
  role?: string | null
  active_status?: boolean | null
  quality_reviewer?: boolean | null
}
export type CardPeopleLink = { team_user_id: string; client_id: string }

export function cardPeople(
  card: CardPeopleCard,
  team: readonly CardPeopleMember[],
  links: readonly CardPeopleLink[],
  meId?: string | null,
): CardPerson[] {
  const active = team.filter(u => u.active_status !== false && u.role !== 'client' && u.id !== meId)
  const byId = new Map(active.map(u => [u.id, u]))
  const onClient = new Set(links.filter(l => l.client_id === card.client_id).map(l => l.team_user_id))
  const schedulers = Array.isArray(card.scheduler_ids) ? card.scheduler_ids.map(String) : []

  const picked: { u: CardPeopleMember; hint: string }[] = []
  const seen = new Set<string>()
  const take = (u: CardPeopleMember | undefined, hint: string) => {
    if (!u || seen.has(u.id)) return
    seen.add(u.id)
    picked.push({ u, hint })
  }

  // the client's account managers first — they own the relationship
  for (const u of active) if (u.role === 'account_manager' && onClient.has(u.id)) take(u, `${roleLabel(u.role)} · this client`)
  // the quality checkers: the role, or the flag on another role
  for (const u of active) if (isQualityReviewer(u)) take(u, u.role === 'quality_checker' ? roleLabel(u.role) : `${roleLabel(u.role)} · quality checker`)
  // the super admins see everything
  for (const u of active) if (u.role === 'super_admin') take(u, roleLabel(u.role))
  // whoever holds the card, and whoever it was handed to
  take(card.owner_id ? byId.get(card.owner_id) : undefined, `${roleLabel(byId.get(String(card.owner_id))?.role)} · has the card`)
  for (const id of schedulers) take(byId.get(id), `${roleLabel(byId.get(id)?.role)} · scheduling it`)

  return picked
    .map(({ u, hint }) => ({ id: u.id, name: String(u.name ?? '').trim() || String(u.email ?? ''), email: String(u.email ?? ''), hint }))
    .filter(p => p.name.length > 0)
}
