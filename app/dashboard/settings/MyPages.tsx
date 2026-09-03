'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EyeOff } from 'lucide-react'
import { GRANTABLE_PAGES, canSeePage } from '@/app/lib/page-access-core'
import { useRole } from '../useRole'

/**
 * Hide pages from MYSELF. A preference, not a permission: a super admin who
 * mutes Leads keeps full super-admin access — the dashboard just stops
 * showing that page and its data surfaces (nav, overview cards). Undo any
 * time, here.
 */
export default function MyPages() {
  const { role } = useRole()
  const [granted, setGranted] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/team/page-access')
      .then(r => (r.ok ? r.json() : { mine: [], hidden: [] }))
      .then(j => { setGranted(j.mine ?? []); setHidden(j.hidden ?? []) })
      .catch(() => setHidden([]))
  }, [])

  // the pages this person can currently see (top-level only, Overview exempt)
  const myPages = useMemo(
    () => GRANTABLE_PAGES.filter(p =>
      !p.parent && p.href !== '/dashboard' && role && canSeePage(role, p.href, granted)),
    [role, granted],
  )

  const toggle = async (href: string) => {
    if (hidden === null) return
    const next = hidden.includes(href) ? hidden.filter(h => h !== href) : [...hidden, href]
    setBusy(href)
    try {
      const res = await fetch('/api/team/page-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ self_hidden: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      setHidden(json.hidden ?? next)
      toast.success(next.includes(href) ? 'Hidden — reload to apply everywhere' : 'Visible again — reload to apply')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  if (hidden === null || role === null) {
    return <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        <div>
          <h3 className="flex items-center gap-2 text-body-15 font-semibold">
            <EyeOff className="h-4 w-4 text-muted-foreground" /> My pages
          </h3>
          <p className="mt-0.5 text-secondary-13 text-muted-foreground">
            Hide pages you don&rsquo;t want in your dashboard. This changes only what YOU see —
            your role and permissions stay exactly the same, and you can undo it here any time.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          {myPages.map(p => {
            const isHidden = hidden.includes(p.href)
            return (
              <label key={p.href}
                className="flex cursor-pointer items-center gap-3 rounded-tile border border-border px-3 py-2 text-body-15 hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={!isHidden}
                  disabled={busy === p.href}
                  onChange={() => void toggle(p.href)}
                  className="h-4 w-4 shrink-0 accent-[var(--dbx-blue)] disabled:opacity-50"
                />
                <span className={isHidden ? 'text-muted-foreground line-through' : ''}>{p.label}</span>
                {isHidden && <span className="ml-auto text-[12px] text-muted-foreground">hidden</span>}
              </label>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
