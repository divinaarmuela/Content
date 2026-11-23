import { isClerkAuthInfo, withClerkMcpAuth } from '@clerk/mcp-tools/next'
import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'
import { table, withRequestCache } from '@/lib/db'
import { mcpAuthOptions } from '@/app/lib/mcp-options'
import { roleSatisfies } from '@/app/lib/identity-core'
import { channelsWithFollowers, publishedBetween } from '@/app/lib/social-analytics'
import type { AnalyticsPost } from '@/app/lib/social-analytics-core'
import {
  MAX_ROWS, SORTS, STAGES, findClient, pickSchedule, publishedPost, readRange, schedulePost, sortPublished, totalsByClient,
  type PostRowLike,
} from '@/app/lib/mcp-core'

/**
 * THE CONNECTOR'S ONE ADDRESS (the owner, 23 Nov 2026). Added in Claude or ChatGPT as a custom connector; the person
 * signs in with their dashboard login and asks about the posts in plain words.
 *
 * WHO MAY ASK: the same people who may open the Analytics and Schedule pages (a scheduler and above), found by the
 * login the token was issued to. A client's login, an editor's, or a switched-off account is refused in words.
 *
 * READ ONLY. Every tool reads; none writes, posts, books or deletes, and none returns a file's address or a token.
 */

type Person = { id: string; name?: string | null; role: string; active_status?: boolean }
type Answer = { content: { type: 'text'; text: string }[]; isError?: boolean }

const say = (data: unknown): Answer => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] })
const refuse = (reason: string): Answer => ({ content: [{ type: 'text', text: reason }], isError: true })

/** the team member behind this request, or the words that refuse them */
async function who(ctx: { http?: { authInfo?: Parameters<typeof isClerkAuthInfo>[0] } }): Promise<{ ok: true; person: Person } | { ok: false; reason: string }> {
  const authInfo = ctx.http?.authInfo
  if (!isClerkAuthInfo(authInfo) || !authInfo.extra.userId) return { ok: false, reason: 'Not signed in. Connect again and sign in with your MD Media dashboard login.' }
  const userId = authInfo.extra.userId
  const row = (await table<Person & { clerk_user_id?: string | null }>('team_users')
    .list({ where: r => r.clerk_user_id === userId, limit: 1 }))[0] ?? null
  if (!row) return { ok: false, reason: 'This login has never opened the MD Media dashboard. Sign in to the dashboard once, then connect again.' }
  if (!row.active_status) return { ok: false, reason: 'This dashboard account is switched off.' }
  if (!roleSatisfies(row.role as never, 'scheduler' as never)) return { ok: false, reason: 'This dashboard account may not see the posting schedule or its numbers.' }
  return { ok: true, person: row }
}

type ClientRow = { id: string; name?: string | null }
type AccountRow = { id: string; client_id?: string | null; platform?: string | null; provider_account_id?: string | null; username?: string | null; active?: boolean }

const realClients = async () => (await table<ClientRow>('clients').list()).filter(c => !!c.name).sort((a, b) => String(a.name).localeCompare(String(b.name)))

/** every published post in the days asked for, each with its client's name */
async function published(from: string, to: string, clientId: string | null) {
  const { channels, clients } = await channelsWithFollowers(clientId, { from, to })
  const nameOf = new Map(clients.map(c => [c.id, c.name]))
  const clientOfAccount = new Map(channels.map(c => [c.provider_account_id, (c.client_id ? nameOf.get(c.client_id) : null) ?? null]))
  let posts: AnalyticsPost[] = []
  let complete = true
  if (clientId) {
    // two channels at a time: the provider allows about six analytics calls a second
    for (let i = 0; i < channels.length; i += 2) {
      const each = await Promise.all(channels.slice(i, i + 2).map(c => publishedBetween(from, to, { accountId: c.provider_account_id })))
      for (const r of each) { posts.push(...(r?.posts ?? [])); if (!r || !r.complete) complete = false }
    }
  } else {
    const r = await publishedBetween(from, to)
    posts = r?.posts ?? []
    complete = !!r && r.complete
  }
  const rows = posts
    .filter(p => p.accountId && clientOfAccount.has(p.accountId))
    .map(p => publishedPost(p, clientOfAccount.get(p.accountId!) ?? null))
  return { rows, complete }
}

const handler = createMcpHandler(server => {
  server.registerTool(
    'whoami',
    { title: 'Who is connected', description: 'Says which MD Media team member this connector is signed in as.' },
    async ctx => withRequestCache(async () => {
      const me = await who(ctx)
      return me.ok ? say({ name: me.person.name ?? null, role: me.person.role }) : refuse(me.reason)
    }),
  )

  server.registerTool(
    'list_clients',
    { title: 'List clients', description: 'Every client of the agency by name, with the social networks connected for each. Read only.' },
    async ctx => withRequestCache(async () => {
      const me = await who(ctx)
      if (!me.ok) return refuse(me.reason)
      const [clients, accounts] = await Promise.all([realClients(), table<AccountRow>('social_accounts').list({ by: { active: true } })])
      return say(clients.map(c => ({
        id: c.id,
        name: c.name,
        networks: [...new Set(accounts.filter(a => a.client_id === c.id).map(a => a.platform).filter(Boolean))],
      })))
    }),
  )

  server.registerTool(
    'published_posts',
    {
      title: 'Published posts and their numbers',
      description: 'Posts that went out between two days, each with views, reach, likes, comments, shares and saves, best first. '
        + 'Give a client name for one client, or leave it out for every client. Numbers for the last two days are still growing. Read only.',
      inputSchema: z.object({
        from: z.string().describe('First day, YYYY-MM-DD'),
        to: z.string().describe('Last day, YYYY-MM-DD'),
        client: z.string().optional().describe('Client name or id; leave out for all clients'),
        sort: z.enum(SORTS).optional().describe('What "best" means; views when left out'),
        limit: z.number().int().min(1).max(MAX_ROWS).optional().describe('How many posts to return; 25 when left out'),
      }),
    },
    async ({ from, to, client, sort, limit }, ctx) => withRequestCache(async () => {
      const me = await who(ctx)
      if (!me.ok) return refuse(me.reason)
      const range = readRange(from, to)
      if (!range.ok) return refuse(range.reason)
      let clientId: string | null = null
      if (client) {
        const found = findClient(await realClients(), client)
        if (!found.ok) return refuse(found.reason)
        clientId = found.client.id
      }
      const { rows, complete } = await published(range.from, range.to, clientId)
      const sorted = sortPublished(rows, sort ?? 'views')
      return say({
        from: range.from, to: range.to,
        posts_found: rows.length,
        all_numbers_in: complete,
        posts: sorted.slice(0, limit ?? 25),
      })
    }),
  )

  server.registerTool(
    'client_totals',
    {
      title: 'Totals by client',
      description: 'For the days asked: how many posts each client published and their total views, reach and engagement, most viewed first. Read only.',
      inputSchema: z.object({ from: z.string().describe('First day, YYYY-MM-DD'), to: z.string().describe('Last day, YYYY-MM-DD') }),
    },
    async ({ from, to }, ctx) => withRequestCache(async () => {
      const me = await who(ctx)
      if (!me.ok) return refuse(me.reason)
      const range = readRange(from, to)
      if (!range.ok) return refuse(range.reason)
      const [{ rows, complete }, clients] = await Promise.all([published(range.from, range.to, null), realClients()])
      const totals = totalsByClient(rows)
      const posted = new Set(totals.map(t => t.client))
      return say({
        from: range.from, to: range.to, all_numbers_in: complete,
        totals,
        clients_with_no_posts_in_these_days: clients.map(c => String(c.name)).filter(n => !posted.has(n)),
      })
    }),
  )

  server.registerTool(
    'schedule',
    {
      title: 'The posting schedule',
      description: 'Posts on the schedule between two days: what is booked, what is waiting for approval, what is still a draft. '
        + 'Give a client name for one client, and a stage to narrow it. Read only.',
      inputSchema: z.object({
        from: z.string().describe('First day, YYYY-MM-DD'),
        to: z.string().describe('Last day, YYYY-MM-DD'),
        client: z.string().optional().describe('Client name or id; leave out for all clients'),
        stage: z.enum(STAGES as [string, ...string[]]).optional().describe('draft, quality_check, with_client, ready, booked, posted or cancelled'),
      }),
    },
    async ({ from, to, client, stage }, ctx) => withRequestCache(async () => {
      const me = await who(ctx)
      if (!me.ok) return refuse(me.reason)
      const range = readRange(from, to)
      if (!range.ok) return refuse(range.reason)
      const clients = await realClients()
      let clientId: string | null = null
      if (client) {
        const found = findClient(clients, client)
        if (!found.ok) return refuse(found.reason)
        clientId = found.client.id
      }
      const [posts, accounts] = await Promise.all([table<PostRowLike>('social_posts').list(), table<AccountRow>('social_accounts').list()])
      const nameOf = new Map(clients.map(c => [c.id, String(c.name)]))
      const network = new Map(accounts.map(a => [a.id, a.platform ?? null]))
      // a day wider each side, so a post late in the day in Melbourne is not lost to the time zone
      const picked = pickSchedule(posts, {
        fromMs: Date.parse(`${range.from}T00:00:00Z`) - 14 * 3_600_000,
        toMs: Date.parse(`${range.to}T23:59:59Z`) + 14 * 3_600_000,
        clientId, stage: stage ?? null,
      })
      return say({
        from: range.from, to: range.to, posts_found: picked.length,
        posts: picked.map(p => schedulePost(p, nameOf.get(String(p.client_id)) ?? null, id => network.get(id) ?? null)),
      })
    }),
  )
})

const authHandler = withClerkMcpAuth(handler, mcpAuthOptions)

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
