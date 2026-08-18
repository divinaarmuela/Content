'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Check, Lock } from 'lucide-react'
import { GRANTABLE_PAGES, defaultAllows } from '@/app/lib/page-access-core'
import type { Role } from '@/app/lib/identity-core'

/**
 * Open dashboard pages to one person.
 *
 * Per person rather than per role: "let Manal see Leads" is the actual
 * request, and granting it to every account manager to reach one of them is
 * how permissions sprawl. Pages someone already has by role show as a fixed
 * tick, not a switch — a grant can only ever add.
 */

type Member = {
  id: string; name: string; email: string; role: Role
  /** null until their first sign-in — set up now, arrives later */
  clerk_user_id: string | null
}

const ROLE_LABEL: Record<string, string> = {
  scheduler: 'Scheduler',
  editor: 'Editor',
  account_manager: 'Account manager',
  super_admin: 'Super admin',
}

export default function PageAccessSettings() {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [grants, setGrants] = useState<Record<string, string[]>>({})
  const [selected, setSelected] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/team/page-access')
    if (!res.ok) { toast.error('Could not load page access'); setMembers([]); return }
    const json = await res.json()
    setMembers(json.members ?? [])
    setGrants(json.grants ?? {})
    setSelected(prev => prev || (json.members?.[0]?.id ?? ''))
  }, [])

  useEffect(() => { void load() }, [load])

  const person = useMemo(
    () => (members ?? []).find(m => m.id === selected) ?? null,
    [members, selected],
  )
  const theirGrants = grants[selected] ?? []

  const toggle = async (href: string) => {
    if (!person) return
    const next = theirGrants.includes(href)
      ? theirGrants.filter(h => h !== href)
      : [...theirGrants, href]
    setBusy(href)
    try {
      const res = await fetch('/api/team/page-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_user_id: person.id, hrefs: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      setGrants(json.grants ?? {})
      const label = GRANTABLE_PAGES.find(p => p.href === href)?.label ?? href
      const who = person.name || person.email
      toast.success(next.includes(href) ? `${who} can now see ${label}` : `${who} no longer sees ${label}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  if (!members) {
    return (
      <Card><CardContent className="flex flex-col gap-3 p-6">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </CardContent></Card>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Who sees which page</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick a person and tick the pages you want them to have. Their role already
              gives them some — those show as a tick and cannot be removed here.
            </p>
          </div>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Pick a person" /></SelectTrigger>
            <SelectContent>
              {members.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name || m.email} · {ROLE_LABEL[m.role] ?? m.role}
                  {m.clerk_user_id ? '' : ' · not signed in yet'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!person ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No team members to configure yet.
          </p>
        ) : person.role === 'super_admin' ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-6 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0" />
            {person.name || person.email} is a super admin and already sees every page.
          </div>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {GRANTABLE_PAGES.map(page => {
              const byDefault = defaultAllows(person.role, page.href)
              const granted = theirGrants.includes(page.href)
              return (
                <label
                  key={page.href}
                  className={
                    'flex items-center gap-3 rounded-md border px-3 py-2 text-sm ' +
                    (byDefault
                      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
                      : 'cursor-pointer border-border hover:bg-muted/50')
                  }
                  title={byDefault ? `${ROLE_LABEL[person.role]}s see this by default` : undefined}
                >
                  {byDefault ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-emerald-600 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={granted}
                      disabled={busy === page.href}
                      onChange={() => void toggle(page.href)}
                      className="h-4 w-4 shrink-0 accent-blue-600 disabled:opacity-50"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate">{page.label}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{page.href}</span>
                  </span>
                  {byDefault && (
                    <span className="ml-auto shrink-0 text-[11px] text-emerald-700 dark:text-emerald-500">
                      by role
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Changes apply the next time that person loads the dashboard. Granting a page
          also opens the data behind it, so the page works rather than erroring.
        </p>
      </CardContent>
    </Card>
  )
}
