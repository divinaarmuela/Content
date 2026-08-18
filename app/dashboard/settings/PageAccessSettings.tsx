'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Check } from 'lucide-react'
import {
  GRANTABLE_ROLES, defaultAllows, type PageAccess,
} from '@/app/lib/page-access-core'
import type { Role } from '@/app/lib/identity-core'

/**
 * Open a dashboard page to roles that would not normally see it.
 *
 * Grants only ever ADD. A page a role already owns shows as a fixed tick
 * rather than a switch, so nobody can try to take work away from the person
 * who does it and quietly break their day.
 */

const PAGES: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/leads', label: 'Leads' },
  { href: '/dashboard/clients', label: 'Clients' },
  { href: '/dashboard/audience', label: 'Audience' },
  { href: '/dashboard/social', label: 'Social channels' },
  { href: '/dashboard/website', label: 'Website' },
  { href: '/dashboard/production', label: 'Production' },
  { href: '/dashboard/scheduler', label: 'Scheduler' },
  { href: '/dashboard/activity', label: 'Team Activity' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/team', label: 'Team' },
  { href: '/dashboard/ai', label: 'AI Assistant' },
  { href: '/dashboard/notifications', label: 'Notifications' },
  { href: '/dashboard/settings', label: 'Settings' },
]

const ROLE_LABEL: Record<string, string> = {
  scheduler: 'Scheduler',
  editor: 'Editor',
  account_manager: 'Account manager',
}

export default function PageAccessSettings() {
  const [access, setAccess] = useState<PageAccess | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/team/page-access')
    if (!res.ok) { toast.error('Could not load page access'); setAccess({}); return }
    setAccess((await res.json()).access ?? {})
  }, [])

  useEffect(() => { void load() }, [load])

  const toggle = async (href: string, role: Role) => {
    if (!access) return
    const current = access[href] ?? []
    const next = current.includes(role) ? current.filter(r => r !== role) : [...current, role]
    setBusy(`${href}:${role}`)
    try {
      const res = await fetch('/api/team/page-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ href, roles: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      setAccess(json.access ?? {})
      toast.success(
        next.includes(role)
          ? `${ROLE_LABEL[role]}s can now see ${PAGES.find(p => p.href === href)?.label}`
          : `${ROLE_LABEL[role]}s no longer see ${PAGES.find(p => p.href === href)?.label}`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  if (!access) {
    return (
      <Card><CardContent className="flex flex-col gap-3 p-6">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </CardContent></Card>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div>
          <h3 className="text-sm font-semibold">Who sees which page</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Roles already have their own pages by default. Tick a box to open one to
            someone else — a tick can only add access, never remove what a role needs
            for its own work. Super admins always see everything.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-4 font-medium">Page</th>
                {GRANTABLE_ROLES.map(r => (
                  <th key={r} className="px-3 pb-2 text-center text-xs font-medium text-muted-foreground">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PAGES.map(page => (
                <tr key={page.href} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4">
                    <span className="block">{page.label}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{page.href}</span>
                  </td>
                  {GRANTABLE_ROLES.map(role => {
                    const byDefault = defaultAllows(role, page.href)
                    const granted = (access[page.href] ?? []).includes(role)
                    const key = `${page.href}:${role}`
                    return (
                      <td key={role} className="px-3 py-2 text-center">
                        {byDefault ? (
                          <span
                            title={`${ROLE_LABEL[role]}s see this by default`}
                            className="inline-flex h-5 w-5 items-center justify-center rounded border border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-400"
                          >
                            <Check className="h-3 w-3" />
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={granted}
                            disabled={busy === key}
                            onChange={() => void toggle(page.href, role)}
                            aria-label={`Show ${page.label} to ${ROLE_LABEL[role]}s`}
                            className="h-4 w-4 accent-blue-600 disabled:opacity-50"
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          A green tick means the role already owns that page and it cannot be taken
          away here. Changes apply the next time that person loads the dashboard.
        </p>
      </CardContent>
    </Card>
  )
}
