import 'server-only'
import { table } from '@/lib/db'
import type { Client, ClientContact } from '@/lib/db-types'
import type { PortalScope } from './portal-owner-core'

/**
 * WHO A PORTAL TOKEN OPENS FOR (the owner, 15 Sep 2026: a person on the
 * client gets a portal of their own). A token is the client's share token —
 * the business portal — or one of the client's people's own token — their
 * portal. One lookup for every door that used to read only the client's:
 * the portal pages, comments, approvals, the plan PDF, the clip lookup.
 *
 * The `slug--token` shape the portal accepts is stripped here, so callers
 * hand over whatever was in the address.
 */
export type PortalOwner = { client: Client; contact: ClientContact | null; scope: PortalScope; token: string }

export async function portalOwnerByToken(rawToken: string): Promise<PortalOwner | null> {
  let token = rawToken
  try { token = decodeURIComponent(rawToken) } catch { /* as given */ }
  token = token.split('--').pop() ?? token
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const client = (await table<Client>('clients').list({ where: r => r.share_token === token, limit: 1 }))[0]
  if (client) return { client, contact: null, scope: { kind: 'business' }, token }
  const contact = (await table<ClientContact>('client_contacts')
    .list({ where: r => (r as { share_token?: string | null }).share_token === token, limit: 1 }))[0]
  if (!contact) return null
  const theirClient = await table<Client>('clients').get(contact.client_id).catch(() => null)
  if (!theirClient) return null
  return { client: theirClient, contact, scope: { kind: 'person', contactId: contact.id, name: contact.name }, token }
}

/** The client behind a token — business or person — for the routes that only
 *  need to know which client is speaking. */
export async function clientByPortalToken(rawToken: string): Promise<Client | null> {
  return (await portalOwnerByToken(rawToken))?.client ?? null
}
