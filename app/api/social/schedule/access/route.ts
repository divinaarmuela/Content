import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount, TeamUser as TeamUserRow, TeamUserClient } from '@/lib/db-types'
import { requireRole } from '@/app/lib/authz'
import { assertClientAccess, scheduleErrorResponse } from '@/app/lib/social-schedule'
import { getPublisher } from '@/app/lib/publisher'
import { mayChangeProfile, peopleWithAccess } from '@/app/lib/social-access-core'
import {
  createProfile, listProfiles, moveAccountsToProfile, providerConfigured,
} from '@/app/lib/zernio-profiles'
import { AuthzError } from '@/app/lib/authz'

/**
 * THE SOCIAL SET AND WHO CAN TOUCH IT, for one client.
 *
 * One request, because the page is one answer to one question — "is this
 * client set up, and who is on it". Every part of it is allowed to fail on
 * its own: the provider being slow must grey out a badge, not blank the page
 * that would tell somebody an account is disconnected.
 *
 * It invents no permission model. The people come straight from
 * `team_user_clients`, and what they may do is read off their role by
 * `social-access-core` — the same rule the server enforces everywhere else,
 * written out in words instead of hidden in a guard.
 */

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const clientId = new URL(req.url).searchParams.get('clientId') ?? ''
      if (!clientId) throw new AuthzError('Which client?', 400)
      await assertClientAccess(user, clientId)

      const [client, accountRows, links, people] = await Promise.all([
        table<Client>('clients').get(clientId),
        table<SocialAccount>('social_accounts')
          .list({ where: a => a.client_id === clientId, orderBy: [['platform', 'asc']] }),
        table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } }),
        table<TeamUserRow>('team_users').list(),
      ])
      if (!client) throw new AuthzError('That client no longer exists', 404)

      const accounts = accountRows.filter(a => a.active !== false)

      const publisher = getPublisher()
      // health per account, each failure collapsing to null — a revoked scope
      // on one channel must not take the other three off the page
      const health = Object.fromEntries(
        (await Promise.all(accounts.map(async a => {
          const h = await publisher
            .accountHealth(a.provider_account_id)
            .catch(() => null) as { tokenStatus?: Record<string, unknown> } | null
          return [a.id, h?.tokenStatus ?? null] as const
        }))).filter(([, v]) => v !== null),
      )

      // the groups of accounts at the posting service, and which one this
      // client is in. `social_profile_id` is that mapping and has been since
      // the connect flow was written — there is no second column for it.
      const mappedId = client.social_profile_id ?? null
      const profiles = providerConfigured()
        ? await listProfiles().catch(() => [])
        : []
      // which of this client's accounts the provider says are NOT in the
      // mapped group. Unknown (an empty answer) is treated as "no strays"
      // rather than as an alarm nobody can act on.
      let stray: string[] = []
      if (mappedId) {
        const inGroup = await publisher.listAccounts(mappedId).catch(() => [])
        const ids = new Set(inGroup.map(a => a.providerAccountId))
        if (ids.size > 0) {
          stray = accounts.filter(a => !ids.has(a.provider_account_id)).map(a => a.id)
        }
      }

      return NextResponse.json({
        client: { id: client.id, name: client.name, timezone: client.timezone ?? null },
        accounts: accounts.map(a => ({
          id: a.id, platform: a.platform, provider_account_id: a.provider_account_id,
          name: a.name, username: a.username, avatar_url: a.avatar_url,
          connected_at: a.connected_at ?? null,
        })),
        health,
        checkedAt: new Date().toISOString(),
        people: peopleWithAccess(links, people),
        profiles,
        profileId: mappedId,
        stray,
        provider: { configured: publisher.configured() },
        can: {
          profile: mayChangeProfile(user.role),
          // assignment stays where it already lives, and so does its rule
          access: user.role === 'super_admin',
        },
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}

/**
 * POST — put this client in a group of accounts at the posting service.
 *
 * `{ clientId, profileId }` maps to an existing group; `{ clientId, name }`
 * makes one first. Either way the client's connected accounts are moved into
 * it, and the answer says which moved and which would not, by name — a
 * half-moved set reported as "done" is the worst outcome available.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const body = await req.json().catch(() => ({}))
      const clientId = String(body.clientId ?? '')
      if (!clientId) throw new AuthzError('Which client?', 400)
      await assertClientAccess(user, clientId)
      if (!mayChangeProfile(user.role)) {
        throw new AuthzError('Only an account manager can change this', 403)
      }

      const client = await table<Client>('clients').get(clientId)
      if (!client) throw new AuthzError('That client no longer exists', 404)

      const name = String(body.name ?? '').trim()
      const profile = name
        ? await createProfile(name)
        : { id: String(body.profileId ?? ''), name: '', accountCount: null }
      if (!profile.id) throw new AuthzError('Pick a group, or give a new one a name', 400)

      // the mapping is written before the moves: it is what every other part
      // of the app reads, and an account moved into a group nothing points at
      // is harder to find than one that has not moved yet
      const saved = await table<Client>('clients').claim(clientId, cur =>
        cur ? { ...cur, social_profile_id: profile.id } : null)
      if (!saved.claimed) {
        throw new AuthzError('Somebody changed this client while you were choosing — try again', 409)
      }

      const accounts = (await table<SocialAccount>('social_accounts')
        .list({ where: a => a.client_id === clientId }))
        .filter(a => a.active !== false)

      const outcome = await moveAccountsToProfile(
        accounts.map(a => ({
          providerAccountId: a.provider_account_id,
          name: a.username ? `@${a.username}` : (a.name ?? a.platform),
        })),
        profile.id,
      )

      return NextResponse.json({
        profileId: profile.id,
        moved: outcome.moved,
        failed: outcome.failed,
        message: outcome.failed.length === 0
          ? `${client.name}’s accounts are all in this group now.`
          : `${outcome.failed.length} account${outcome.failed.length === 1 ? '' : 's'} would not move: ${outcome.failed.map(f => `${f.name} — ${f.why}`).join('; ')}`,
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
