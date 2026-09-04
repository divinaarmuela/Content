import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { AuthzError, requireRole } from '@/app/lib/authz'
import { assertClientAccess, scheduleErrorResponse } from '@/app/lib/social-schedule'
import { getPublisher } from '@/app/lib/publisher'
import { mayChangeAccess, mayChangeProfile } from '@/app/lib/social-access-core'
import {
  createProfile, listProfiles, moveAccountsToProfile, providerConfigured,
} from '@/app/lib/zernio-profiles'

/**
 * WHAT ONLY THE SERVER CAN ANSWER about a client's social set.
 *
 * Deliberately not "everything the page needs". The accounts, the client and
 * who is on it are rows in the database, and the page reads those the way
 * every other live screen does — a listener, so an account connected in
 * another tab or a person added to the client repaints this page without
 * anybody pressing anything. What CANNOT come from a listener is the bit that
 * lives at the provider: whether each token still works, which groups of
 * accounts exist, and which of this client's accounts are not in theirs.
 *
 * Every part of it is allowed to fail on its own. A slow provider must grey
 * out a badge, not blank the page that would tell somebody an account is
 * disconnected — and a health check that did not answer is reported as "not
 * checked", never as "connected".
 */

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const clientId = new URL(req.url).searchParams.get('clientId') ?? ''
      if (!clientId) throw new AuthzError('Which client?', 400)
      await assertClientAccess(user, clientId)

      const [client, accountRows] = await Promise.all([
        table<Client>('clients').get(clientId),
        table<SocialAccount>('social_accounts')
          .list({ where: a => a.client_id === clientId, orderBy: [['platform', 'asc']] }),
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
        health,
        checkedAt: new Date().toISOString(),
        profiles,
        profileId: mappedId,
        stray,
        provider: { configured: publisher.configured() },
        can: {
          profile: mayChangeProfile(user.role),
          // assignment stays where it already lives, and so does its rule
          access: mayChangeAccess(user.role),
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
 * makes one first (adopting the one that exists if the name is taken). Either
 * way the client's connected accounts are moved into it, the group is READ
 * BACK, and the answer says which really moved and which did not, by name — a
 * half-moved set reported as "done" is the worst outcome available, and so is
 * a request the provider accepts and quietly ignores.
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

      const publisher = getPublisher()
      const outcome = await moveAccountsToProfile(
        accounts.map(a => ({
          providerAccountId: a.provider_account_id,
          name: a.username ? `@${a.username}` : (a.name ?? a.platform),
        })),
        profile.id,
        // the 200 is not proof: read the group back and believe THAT
        async id => (await publisher.listAccounts(id)).map(a => a.providerAccountId),
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
