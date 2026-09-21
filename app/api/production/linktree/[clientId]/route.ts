import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { LinktreeConnection } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { accessibleClientIds } from '../../../../lib/production-access'
import {
  analyticsWindow, cleanLinkInput, linksFrom, linktreeErrorWords, mayManageLinktree, numbersFrom, profilesFrom,
} from '../../../../lib/linktree-core'
import { freshAccessToken, withLinktree } from '../../../../lib/linktree'

/**
 * A CLIENT'S LINKTREE (21 Sep 2026). GET reads it for anyone on the team who
 * may see the client: the profile, its links in order, and 28 days of views
 * and clicks. POST is a manager's: pick the profile, add, edit, hide, move or
 * delete a link, or disconnect. Tokens never leave the server.
 */
export const dynamic = 'force-dynamic'

type Conn = LinktreeConnection & { profile_username?: string | null; profile_url?: string | null; profile_name?: string | null; last_error?: string | null }

async function allowedClient(user: Parameters<typeof accessibleClientIds>[0], clientId: string): Promise<boolean> {
  const ids = await accessibleClientIds(user)
  return ids === null || ids.includes(clientId)
}

export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler') // any team role; excludes `client`
      const { clientId } = await params
      if (!(await allowedClient(user, clientId))) return NextResponse.json({ error: 'Not your client' }, { status: 404 })
      const conn = await table<LinktreeConnection>('linktree_connections').get(clientId) as Conn | null
      if (!conn) return NextResponse.json({ connected: false })
      try {
        const token = await freshAccessToken(conn)
        const username = conn.profile_username ?? null
        const out = await withLinktree(token, async call => {
          if (!username) return { profiles: profilesFrom(await call('list_accessible_profiles', { allPages: true })), links: [], numbers: null }
          const links = linksFrom(await call('get_links', { username }))
          const win = analyticsWindow(Date.now())
          // numbers are a bonus: a free profile may refuse part of them, and the links still show
          const numbers = await call('get_account_analytics', { username, ...win })
            .then(d => numbersFrom(d, win.startDate, win.endDate)).catch(() => null)
          return { profiles: [], links, numbers }
        })
        return NextResponse.json({
          connected: true,
          profile: username ? { username, url: conn.profile_url ?? `https://linktr.ee/${username}`, name: conn.profile_name ?? null } : null,
          ...out,
        })
      } catch (e) {
        const words = linktreeErrorWords(e instanceof Error ? e.message : '')
        await table<LinktreeConnection>('linktree_connections').update(clientId, { last_error: words, updated_at: new Date().toISOString() } as never).catch(() => null)
        return NextResponse.json({ connected: true, profile: conn.profile_username ? { username: conn.profile_username, url: conn.profile_url ?? null, name: conn.profile_name ?? null } : null, profiles: [], links: [], numbers: null, error: words })
      }
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayManageLinktree(user)) return NextResponse.json({ error: 'An account manager or a super admin edits a client’s Linktree' }, { status: 403 })
      const { clientId } = await params
      if (!(await allowedClient(user, clientId))) return NextResponse.json({ error: 'Not your client' }, { status: 404 })
      const conns = table<LinktreeConnection>('linktree_connections')
      const conn = await conns.get(clientId) as Conn | null
      if (!conn) return NextResponse.json({ error: 'Connect the Linktree first' }, { status: 409 })
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const action = String(body.action ?? '')
      const now = new Date().toISOString()

      if (action === 'disconnect') {
        await conns.remove(clientId)
        return NextResponse.json({ ok: true })
      }

      const token = await freshAccessToken(conn)
      try {
        if (action === 'pick_profile') {
          const want = String(body.username ?? '').trim()
          const picked = await withLinktree(token, async call => profilesFrom(await call('list_accessible_profiles', { allPages: true })).find(p => p.username === want) ?? null)
          if (!picked) return NextResponse.json({ error: 'That profile is not one this sign-in can reach' }, { status: 404 })
          await conns.update(clientId, { profile_username: picked.username, profile_url: picked.profileUrl, profile_name: picked.displayName, updated_at: now, last_error: null } as never)
          return NextResponse.json({ ok: true })
        }
        const username = conn.profile_username
        if (!username) return NextResponse.json({ error: 'Pick which Linktree profile this client uses' }, { status: 409 })
        const id = Number(body.id)
        const result = await withLinktree(token, async call => {
          if (action === 'add_link') {
            const clean = cleanLinkInput({ title: body.title, url: body.url })
            if (!clean.ok) throw new Error(clean.error)
            return call('add_link', { username, url: clean.url, ...(clean.title ? { title: clean.title } : {}), active: true })
          }
          if (!Number.isFinite(id)) throw new Error('Which link?')
          if (action === 'update_link') {
            const patch: Record<string, unknown> = { username, id }
            if ('active' in body) patch.active = body.active !== false
            if ('title' in body || 'url' in body) {
              const clean = cleanLinkInput({ title: body.title, url: body.url })
              if (!clean.ok) throw new Error(clean.error)
              patch.title = clean.title; patch.url = clean.url
            }
            return call('update_link', patch)
          }
          if (action === 'move_link') return call('reorder_link', { username, id, ...(body.direction === 'up' ? { up: 1 } : { down: 1 }) })
          if (action === 'delete_link') return call('delete_link', { username, id })
          throw new Error('Unknown action')
        })
        return NextResponse.json({ ok: true, result })
      } catch (e) {
        return NextResponse.json({ error: linktreeErrorWords(e instanceof Error ? e.message : '') }, { status: 422 })
      }
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
