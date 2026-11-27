import 'server-only'
import { table } from '@/lib/db'
import type { TeamUser } from '@/lib/db-types'
import { inboxAddress, inboxPerson, withInbox } from './client-answer-inbox-core'

/** The team account that hears every client answer (client-answer-inbox-core), or null. Never throws. */
export async function clientAnswerInbox(): Promise<{ id: string; email: string; name: string; role: string; active_status: boolean } | null> {
  const address = inboxAddress(process.env.CLIENT_ANSWER_INBOX)
  if (!address) return null
  const people = await table<TeamUser>('team_users')
    .list({ where: u => String(u.email ?? '').trim().toLowerCase() === address })
    .catch(() => [] as TeamUser[])
  const p = inboxPerson(people as unknown as { id: string; email?: string | null; role?: string | null; active_status?: boolean | null }[], address)
  return p ? { id: p.id, email: String(p.email), name: String((p as { name?: string | null }).name ?? p.email), role: String(p.role ?? ''), active_status: true } : null
}

/** the people a client-answer email goes to, with the inbox's account added once */
export async function withClientAnswerInbox<T extends { id: string; email: string }>(people: readonly T[]): Promise<T[]> {
  return withInbox(people, (await clientAnswerInbox()) as unknown as T | null)
}
