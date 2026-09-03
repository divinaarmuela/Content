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
import { ROLE_LABEL, type Role } from '@/app/lib/identity-core'

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

export default function PageAccessSettings() {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [grants, setGrants] = useState<Record<string, string[]>>({})
  const [hiddenBy, setHiddenBy] = useState<Record<string, string[]>>({})
  const [selected, setSelected] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/team/page-access')
    if (!res.ok) { toast.error('Could not load page access'); setMembers([]); return }
    const json = await res.json()
    setMembers(json.members ?? [])
    setGrants(json.grants ?? {})
    setHiddenBy(json.hiddenByUser ?? {})
    setSelected(prev => prev || (json.members?.[0]?.id ?? ''))
  }, [])

  useEffect(() => { void load() }, [load])

  const person = useMemo(
    () => (members ?? []).find(m => m.id === selected) ?? null,
    [members, selected],
  )
  const theirGrants = grants[selected] ?? []

  /** Change what someone IS, not just what they see: their role drives the
   *  default pages (green ticks) and every server-side permission. Ticking
   *  boxes can never turn an editor into an account manager — this can. */
  const setRole = async (role: Role) => {
    if (!person || person.role === role) return
    setBusy('role')
    try {
      const res = await fetch(`/api/team/${person.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not change role')
      toast.success(`${person.name || person.email} is now ${ROLE_LABEL[role] ?? role}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change role')
    } finally {
      setBusy(null)
    }
  }

  const clearGrants = async () => {
    if (!person || theirGrants.length === 0) return
    setBusy('clear')
    try {
      const res = await fetch('/api/team/page-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_user_id: person.id, hrefs: [] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not clear')
      setGrants(json.grants ?? {})
      toast.success(`${person.name || person.email} is back to their role's defaults`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear')
    } finally {
      setBusy(null)
    }
  }

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
            <h3 className="text-body-15 font-semibold">Who sees which page</h3>
            <p className="mt-0.5 text-secondary-13 text-muted-foreground">
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
          <p className="py-8 text-center text-body-15 text-muted-foreground">
            No team members to configure yet.
          </p>
        ) : person.role === 'super_admin' ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-tile border border-border bg-muted/40 px-3 py-3 text-body-15 text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0" />
              {person.name || person.email} is a super admin and may see every page — but you
              can hide pages from their view. Their permissions stay untouched.
            </div>
            <div className="flex flex-col gap-1.5">
              {GRANTABLE_PAGES.filter(p => !p.parent && p.href !== '/dashboard').map(page => {
                const isHidden = (hiddenBy[person.id] ?? []).includes(page.href)
                return (
                  <label key={page.href}
                    className="flex cursor-pointer items-center gap-3 rounded-tile border border-border px-3 py-2 text-body-15 hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      disabled={busy === page.href}
                      onChange={async () => {
                        const current = hiddenBy[person.id] ?? []
                        const next = isHidden ? current.filter(h => h !== page.href) : [...current, page.href]
                        setBusy(page.href)
                        try {
                          const res = await fetch('/api/team/page-access', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ team_user_id: person.id, hidden_hrefs: next }),
                          })
                          const json = await res.json()
                          if (!res.ok) throw new Error(json.error ?? 'Could not save')
                          setHiddenBy(prev => ({ ...prev, [person.id]: json.hidden ?? next }))
                          toast.success(isHidden
                            ? `${page.label} visible to ${person.name || person.email} again`
                            : `${page.label} hidden from ${person.name || person.email}`)
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Could not save')
                        } finally {
                          setBusy(null)
                        }
                      }}
                      className="h-4 w-4 shrink-0 accent-blue-600 disabled:opacity-50"
                    />
                    <span className={isHidden ? 'text-muted-foreground line-through' : ''}>{page.label}</span>
                    {isHidden && <span className="ml-auto text-[12px] text-muted-foreground">hidden</span>}
                  </label>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* the role IS the baseline — change it here rather than
                approximating a role with a pile of page grants */}
            <div className="flex flex-wrap items-center gap-2 rounded-tile border border-border bg-muted/30 px-3 py-2.5">
              <span className="text-secondary-13 text-muted-foreground">Role</span>
              {(['scheduler', 'editor', 'account_manager'] as Role[]).map(r => (
                <button
                  key={r}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void setRole(r)}
                  className={
                    'rounded-full border px-3 py-1 text-secondary-13 transition-colors disabled:opacity-50 ' +
                    (person.role === r
                      ? 'border-accent-blue/25 bg-accent-blue text-white'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground')
                  }
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
              <span className="text-[12px] text-muted-foreground">
                changes their default pages and permissions everywhere
              </span>
              {theirGrants.length > 0 && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void clearGrants()}
                  className="ml-auto rounded-tile border border-border px-2.5 py-1 text-secondary-13 text-muted-foreground hover:text-accent-red disabled:opacity-50"
                >
                  Clear {theirGrants.length} extra page{theirGrants.length > 1 ? 's' : ''}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
            {GRANTABLE_PAGES.map(page => {
              const byDefault = defaultAllows(person.role, page.href)
              const granted = theirGrants.includes(page.href)
              return (
                <label
                  key={page.href}
                  className={
                    (page.parent ? 'ml-6 ' : '') +
                    'flex items-center gap-3 rounded-tile border px-3 py-2 text-body-15 ' +
                    (byDefault
                      ? 'border-accent-green/30 bg-tint-green'
                      : 'cursor-pointer border-border hover:bg-muted/50')
                  }
                >
                  {byDefault ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-tile bg-accent-green text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={granted}
                      disabled={busy !== null}
                      onChange={() => void toggle(page.href)}
                      className="h-4 w-4 shrink-0 accent-blue-600 disabled:opacity-50"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate">
                      {page.label}
                      {page.parent && <span className="ml-1.5 text-[12px] text-muted-foreground">tab inside Clients</span>}
                    </span>
                    <span className="block font-mono text-[12px] text-muted-foreground">{page.href}</span>
                  </span>
                  {/* was a hover-only title= — on a phone "by role" explained
                      nothing. Now it says who sees it, in words, on the row. */}
                  {byDefault && (
                    <span className="ml-auto shrink-0 text-right text-[12px] text-foreground">
                      every {ROLE_LABEL[person.role].toLowerCase()} sees this
                    </span>
                  )}
                </label>
              )
            })}
            </div>
          </div>
        )}

        <p className="text-secondary-13 text-muted-foreground">
          Changes apply the next time that person loads the dashboard. Granting a page
          also opens the data behind it, so the page works rather than erroring.
        </p>
      </CardContent>
    </Card>
  )
}
