import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../lib/authz'
import { projectColour } from '../../../lib/todo-inbox-core'

/**
 * THE TO-DOS PROJECTS (the owner, 20 Oct 2026, Manal's video of Asana's Projects: "a project section … based off
 * clients … if I am looking at StretchWorks I can see what other people are working on"; "make sure it shows their
 * own logo"). The clients a person can open as a project — a super admin every client with work, everyone else the
 * clients they are on — each with its logo (its own social account's picture) or its brand's colour.
 */
type Social = { id: string; client_id?: string | null; avatar_url?: string | null; active?: boolean | null }
type Link = { id: string; team_user_id: string; client_id: string }
type TodoLite = { id: string; client_id?: string | null; status?: string | null; parent_id?: string | null }

export async function GET() {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const [clients, socials, links, todos] = await Promise.all([
        table<Client>('clients').list(),
        table<Social>('social_accounts').list().catch(() => [] as Social[]),
        table<Link>('team_user_clients').list({ by: { team_user_id: user.id } }).catch(() => [] as Link[]),
        table<TodoLite>('todos').list().catch(() => [] as TodoLite[]),
      ])
      const open = new Map<string, number>()
      for (const t of todos) if (t.client_id && !t.parent_id && t.status !== 'done') open.set(t.client_id, (open.get(t.client_id) ?? 0) + 1)
      const mine = new Set(links.map(l => l.client_id))
      const logo = new Map<string, string>()
      for (const s of socials) if (s.client_id && s.active !== false && s.avatar_url && !logo.has(s.client_id)) logo.set(s.client_id, s.avatar_url)
      const projects = clients
        .filter(c => user.role === 'super_admin'
          ? (open.has(c.id) || (c as { status?: string | null }).status === 'active')
          : mine.has(c.id))
        .map(c => {
          const brand = ((c as { brand_profile?: { colours?: { hex?: string; role?: string }[] } | null }).brand_profile?.colours ?? [])
          const primary = brand.find(x => x.role === 'primary')?.hex ?? brand[0]?.hex ?? null
          return { id: c.id, name: c.name, logo: logo.get(c.id) ?? null, colour: projectColour(c.id, primary), open: open.get(c.id) ?? 0, mine: mine.has(c.id) }
        })
        .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name))
      return NextResponse.json({ projects })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
