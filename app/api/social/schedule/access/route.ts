import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { AuthzError, requireRole } from '@/app/lib/authz'
import { assertClientAccess, scheduleErrorResponse } from '@/app/lib/social-schedule'
import { getPublisher } from '@/app/lib/publisher'
import {
  groupSetupReport, mayChangeAccess, mayChangeProfile,
  type AccountHealth, type ProfileChoice,
} from '@/app/lib/social-access-core'
import {
  findOrCreateProfile, listProfiles, moveAccountsToProfile, providerConfigured,
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
 *
 * -- AND IT IS ALLOWED TO BE SLOW ON ITS OWN, ONCE --
 *
 * The three provider questions used to run one after another, none of them
 * bounded: the health checks, then the list of groups, then who is in this
 * client's group. A provider having a bad afternoon therefore held the whole
 * request for the SUM of them, and switching client on the access page sat
 * there for half a minute before anything appeared. They are one `Promise.all`
 * now, each with its own deadline, so the worst case is one deadline rather
 * than three unbounded waits — and whatever missed it degrades to exactly what
 * a failure already degraded to.
 */

/** How long any one provider question may take before we answer without it. */
const PROVIDER_DEADLINE_MS = 6000

/** `work`, or `fallback` if it has not answered in time. A slow answer is
 *  dropped rather than awaited: the page asks again on "Check them". */
function within<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    work.catch(() => fallback),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), PROVIDER_DEADLINE_MS)),
  ])
}

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
      // the groups of accounts at the posting service, and which one this
      // client is in. `social_profile_id` is that mapping and has been since
      // the connect flow was written — there is no second column for it.
      const mappedId = client.social_profile_id ?? null

      // ALL THREE AT ONCE, each with its own deadline
      const [healthPairs, profiles, inGroup] = await Promise.all([
        // health per account, each failure collapsing to null — a revoked
        // scope on one channel must not take the other three off the page
        Promise.all(accounts.map(async a => {
          // THE WHOLE payload, not just its token. The status word, what the
          // account may still DO and the provider's own issue list are what
          // separate "renewing its login" from "broken", and sending only the
          // token is how two working accounts came to be badged as needing
          // reconnecting (`healthBlocksPosting` in social-access-core.ts).
          const h = await within(
            publisher.accountHealth(a.provider_account_id) as Promise<AccountHealth | null>,
            null,
          )
          return [a.id, h ?? null] as const
        })),
        providerConfigured() ? within(listProfiles(), []) : Promise.resolve([]),
        mappedId
          ? within(publisher.listAccounts(mappedId), [])
          : Promise.resolve([] as { providerAccountId: string }[]),
      ])

      const health = Object.fromEntries(healthPairs.filter(([, v]) => v !== null))

      // which of this client's accounts the provider says are NOT in the
      // mapped group. Unknown (an empty answer) is treated as "no strays"
      // rather than as an alarm nobody can act on.
      let stray: string[] = []
      const ids = new Set(inGroup.map(a => a.providerAccountId))
      if (mappedId && ids.size > 0) {
        stray = accounts.filter(a => !ids.has(a.provider_account_id)).map(a => a.id)
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
 * `{ clientId, profileId }` maps to an existing group; `{ clientId, name }` is
 * the "set this client up" press — it ADOPTS the group already named after
 * them and only makes one when there is none. Either
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

      /**
       * TWO WAYS IN, ONE PATH THROUGH.
       *
       * `{ name }` is "set this client up": find the group named after them or
       * make one — `findOrCreateProfile` reads the list first and matches it
       * the way the Drive adoption matches a folder, so pressing this twice,
       * or pressing it for a client whose group somebody made by hand, adopts
       * rather than leaving a second group with the same name behind.
       *
       * `{ profileId }` is somebody choosing a particular group from the menu,
       * including one that is not named after the client at all — a decision
       * the page is allowed to make and this route is not allowed to second
       * guess. Its name is looked up only so the answer can say where the
       * accounts went; a listing we could not read costs a nicer sentence and
       * nothing else.
       */
      const name = String(body.name ?? '').trim()
      let adopted = true
      let profile: ProfileChoice
      if (name) {
        const found = await findOrCreateProfile(name)
        profile = found.profile
        adopted = found.adopted
      } else {
        const id = String(body.profileId ?? '')
        const known = id
          ? await listProfiles().then(ps => ps.find(p => p.id === id) ?? null).catch(() => null)
          : null
        profile = known ?? { id, name: '', accountCount: null }
      }
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
        groupName: profile.name || name || 'this group',
        adopted,
        moved: outcome.moved,
        failed: outcome.failed,
        // per account, by name, and never "done" while something is still
        // where it was — see `groupSetupReport`
        message: groupSetupReport({
          clientName: client.name,
          groupName: profile.name || name || 'this group',
          moved: outcome.moved,
          failed: outcome.failed,
          adopted,
        }),
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
